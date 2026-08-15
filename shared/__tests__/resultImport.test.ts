/**
 * Parser tests, written against the shapes result sheets actually arrive in:
 * a tab-separated copy out of a portal table, a CSV export, a fixed-width PDF
 * paste, and a plain list with no header at all. The awkward parts — telling
 * units from a score, and points-per-unit from quality points — are pinned down
 * explicitly, because getting those the wrong way round silently corrupts a GPA.
 */

import { describe, expect, it } from 'vitest';
import { parseResultText } from '../resultImport';

describe('parseResultText', () => {
  it('reads a tab-separated table with a header', () => {
    const text = [
      'Course Code\tCourse Title\tUnits\tScore\tGrade\tPoints',
      'CSC 201\tData Structures\t3\t72\tB\t4',
      'MTH 101\tCalculus I\t4\t85\tA\t5',
    ].join('\n');

    const { rows } = parseResultText(text);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      courseCode: 'CSC 201',
      courseName: 'Data Structures',
      units: 3,
      score: 72,
      gradeName: 'B',
      gradePoint: 4,
      qualityPoints: 12,
    });
    expect(rows[1].qualityPoints).toBe(20);
  });

  it('reads a CSV export', () => {
    const text = [
      'Code,Title,Unit,Score,Grade,QP',
      'GST 102,Use of English II,2,68,B,8',
      'PHY 105,Heat and Properties of Matter,3,55,C,9',
    ].join('\n');

    const { rows } = parseResultText(text);

    expect(rows.map((row) => row.courseCode)).toEqual(['GST 102', 'PHY 105']);
    // 8 quality points over 2 units is 4 per unit, not "4 points" restated.
    expect(rows[0].gradePoint).toBe(4);
    expect(rows[0].qualityPoints).toBe(8);
    expect(rows[1].courseName).toBe('Heat and Properties of Matter');
  });

  it('treats a points column above the scale as the course total', () => {
    const text = ['Code,Title,Units,Quality Points', 'CHM 101,General Chemistry,4,16'].join('\n');

    const { rows } = parseResultText(text);

    expect(rows[0].qualityPoints).toBe(16);
    expect(rows[0].gradePoint).toBe(4);
  });

  it('reads a fixed-width table pasted out of a PDF', () => {
    const text = [
      'CODE        TITLE                     UNIT   SCORE   GRADE   QP',
      'ENG 201     Technical Writing          2      64      B       8',
      'CSC 205     Operating Systems          3      45      D       6',
    ].join('\n');

    const { rows } = parseResultText(text);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ courseCode: 'ENG 201', units: 2, score: 64, gradeName: 'B' });
    expect(rows[1]).toMatchObject({ courseCode: 'CSC 205', units: 3, score: 45, gradeName: 'D' });
  });

  it('reads lines with no header, keeping units and score apart', () => {
    const text = ['CSC 201 Data Structures 3 72 B 12', 'MTH101 Calculus I 4 85 A 20'].join('\n');

    const { rows } = parseResultText(text);

    expect(rows[0]).toEqual({
      courseCode: 'CSC 201',
      courseName: 'DATA STRUCTURES',
      units: 3,
      score: 72,
      gradeName: 'B',
      gradePoint: 4,
      qualityPoints: 12,
    });
    expect(rows[1]).toMatchObject({ courseCode: 'MTH 101', units: 4, score: 85, gradePoint: 5 });
  });

  it('derives the missing side of the points arithmetic', () => {
    // Units and quality points only: the per-unit point follows from them.
    const { rows } = parseResultText('BIO 101 Introductory Biology 3 15');
    expect(rows[0]).toMatchObject({ units: 3, qualityPoints: 15, gradePoint: 5 });
  });

  it('ignores totals, headings and page furniture', () => {
    const text = [
      'AHMADU BELLO UNIVERSITY',
      'First Semester Result 2023/2024',
      'Name: A. Student    Matric No: U19CS1001',
      'CSC 201 Data Structures 3 72 B 12',
      'TOTAL 3 72 12',
      'GPA: 4.00   CGPA: 3.85',
    ].join('\n');

    const { rows } = parseResultText(text);

    expect(rows).toHaveLength(1);
    expect(rows[0].courseCode).toBe('CSC 201');
  });

  it('keeps the first of a repeated course and says so', () => {
    const { rows, notes } = parseResultText(
      ['CSC 201 Data Structures 3 72 B 12', 'CSC 201 Data Structures 3 72 B 12'].join('\n'),
    );

    expect(rows).toHaveLength(1);
    expect(notes.some((note) => note.includes('CSC 201'))).toBe(true);
  });

  it('reports when nothing could be recognised', () => {
    const { rows, notes } = parseResultText('a screenshot with no text worth reading');

    expect(rows).toHaveLength(0);
    expect(notes[0]).toMatch(/no course rows/i);
  });

  it('does not mistake a "Grade Point" column for the grade column', () => {
    // The layout most Nigerian portals export, and the reason grades imported blank.
    const text = [
      'S/N  COURSE CODE  COURSE TITLE  UNIT  SCORE  GRADE  GRADE POINT',
      '1  CSC 201  Data Structures  3  72  B  4',
      '2  MTH 101  Calculus I  4  85  A  5',
    ].join('\n');

    const { rows } = parseResultText(text);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      courseCode: 'CSC 201',
      units: 3,
      score: 72,
      gradeName: 'B',
      gradePoint: 4,
      qualityPoints: 12,
    });
    expect(rows[1]).toMatchObject({ gradeName: 'A', qualityPoints: 20 });
  });

  it('still finds the grade when a row has fewer cells than the header', () => {
    // PDF text does not always yield one cell per column; the letter is found
    // wherever it sits rather than only where the header said it would be.
    const text = ['CODE  TITLE  UNIT  SCORE  GRADE', 'CSC 201  Data Structures  3  B'].join('\n');

    const { rows } = parseResultText(text);

    expect(rows[0]).toMatchObject({ courseCode: 'CSC 201', units: 3, gradeName: 'B' });
  });

  it('flags rows that arrived without units', () => {

    const { rows, notes } = parseResultText('Code,Title,Grade\nCSC 201,Data Structures,B');

    expect(rows[0].units).toBeNull();
    expect(notes.some((note) => note.includes('no units'))).toBe(true);
  });

  /*
   * The reported bug: a PDF whose rows carry an extra leading cell (a serial
   * number the header does not declare) shifted every value one column left, so
   * the title column held a figure and the units column held a mark. Twelve rows
   * parsed and none could be saved. Values must be checked against the field
   * claiming them, not accepted on position alone.
   */
  it('recovers a row whose cells are shifted out of line with the header', () => {
    const text = [
      'COURSE CODE  COURSE TITLE  UNIT  SCORE  GRADE',
      '1  CSC 201  Data Structures  3  72  B',
    ].join('\n');

    const { rows } = parseResultText(text);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      courseCode: 'CSC 201',
      courseName: 'DATA STRUCTURES',
      units: 3,
      score: 72,
      gradeName: 'B',
    });
  });

  it('never reads a mark as a unit count', () => {
    // 72 units is not a course; the row keeps the mark and reports no units
    // rather than importing an unusable figure.
    const { rows } = parseResultText('Code,Title,Units\nCSC 201,Data Structures,72');

    expect(rows[0].units).not.toBe(72);
    expect(rows[0].courseName).toBe('Data Structures');
  });

  it('does not accept a figure as a course title', () => {
    const text = ['CODE  TITLE  UNIT  GRADE', 'CSC 201  3  3  B'].join('\n');

    const { rows } = parseResultText(text);

    // "3" is a shifted cell, not a title, and must not be saved as one.
    expect(rows[0].courseName).not.toBe('3');
    expect(rows[0]).toMatchObject({ courseCode: 'CSC 201', units: 3, gradeName: 'B' });
  });
});


