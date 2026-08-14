/**
 * Reading a result sheet.
 *
 * Students already have their results as a file — a portal download, a copied
 * table, an exported spreadsheet — and typing every row again is the slowest part
 * of using AcadMap. This turns that text into candidate records: course code,
 * title, units, score, grade and quality points.
 *
 * It works on text only, and deliberately knows nothing about files, the DOM or
 * the store, which is what makes it testable and keeps it usable from either
 * side of the app. Extracting text from a PDF happens at the edge, in the upload
 * component; nothing here ever sees or keeps the file.
 *
 * The parser is forgiving by design and never guesses silently: every row it
 * returns is shown to the student for confirmation before anything is saved, and
 * anything it could not read is reported in `notes` rather than dropped without
 * a word.
 */

export interface ParsedResultRow {
  courseCode: string;
  courseName: string;
  units: number | null;
  /** Raw mark out of 100, when the sheet carries one. */
  score: number | null;
  /** Letter grade as written on the sheet, e.g. "A", "B+". */
  gradeName: string;
  /** Points per unit, e.g. 5 for an A on a 5.0 scale. */
  gradePoint: number | null;
  /** Total points for the course: gradePoint × units. */
  qualityPoints: number | null;
}

export interface ParseOutcome {
  rows: ParsedResultRow[];
  /** Lines that looked like data but could not be read. */
  skipped: number;
  /** Human-readable observations for the review screen. */
  notes: string[];
}

/** e.g. CSC 201, MTH101, GST-102A. */
const COURSE_CODE = /\b([A-Z]{2,5})[\s-]?(\d{3}[A-Z]?)\b/;
const GRADE = /^[A-F][+-]?$/;
const NUMBER = /^\d{1,3}(?:\.\d{1,2})?$/;

/** Lines that are summaries or page furniture rather than courses. */
const NOT_A_COURSE =
  /^(total|tcu|tcp|tnu|tqp|gpa|cgpa|summary|remark|semester|session|level|name|reg(istration)?\s*(no|number)|matric|student|result|transcript|page|signature|printed)\b/i;

type Field = 'code' | 'name' | 'units' | 'score' | 'grade' | 'qp';

/**
 * Which column a header cell describes.
 *
 * Order matters: "Course Code" and "Course Title" both contain "course", so the
 * more specific words are tested first.
 */
function headerField(label: string): Field | null {
  const value = label.toLowerCase();
  if (!value) return null;
  if (/\bcodes?\b/.test(value)) return 'code';
  if (/unit|credit|\bcu\b|load/.test(value)) return 'units';
  if (/score|mark|raw|%/.test(value)) return 'score';
  if (/grade|letter/.test(value)) return 'grade';
  if (/\bqp\b|quality|point|\bgp\b|weight/.test(value)) return 'qp';
  if (/course|title|subject|description|name/.test(value)) return 'name';
  return null;
}

/**
 * Splits one line into cells.
 *
 * Tabs and commas are unambiguous. Failing those, runs of two or more spaces are
 * how a fixed-width table pasted out of a PDF separates its columns; single
 * spaces are the last resort, because a course title contains them too.
 */
function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
  if ((line.match(/,/g)?.length ?? 0) >= 2) return line.split(',').map((cell) => cell.trim());
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((cell) => cell.trim());
  return line.trim().split(/\s+/);
}

function toNumber(value: string): number | null {
  const cleaned = value.replace(/[^\d.]/g, '');
  if (!NUMBER.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A header row is one where at least two cells name a column we understand. */
function readHeader(line: string): Partial<Record<Field, number>> | null {
  const cells = splitCells(line);
  const map: Partial<Record<Field, number>> = {};
  let matches = 0;

  cells.forEach((cell, index) => {
    const field = headerField(cell);
    if (!field || map[field] !== undefined) return;
    map[field] = index;
    matches += 1;
  });

  // A course row can accidentally match one keyword; two is a header.
  return matches >= 2 ? map : null;
}

function tidyName(value: string): string {
  return value
    .replace(COURSE_CODE, ' ')
    .replace(/[|;]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function blankRow(): ParsedResultRow {
  return {
    courseCode: '',
    courseName: '',
    units: null,
    score: null,
    gradeName: '',
    gradePoint: null,
    qualityPoints: null,
  };
}

/** Reads a line using the column positions found in the header. */
function fromColumns(line: string, map: Partial<Record<Field, number>>): ParsedResultRow | null {
  const cells = splitCells(line);
  const at = (field: Field): string => {
    const index = map[field];
    return index === undefined ? '' : (cells[index] ?? '').trim();
  };

  const row = blankRow();
  const codeCell = at('code');
  const codeMatch = (codeCell || line).toUpperCase().match(COURSE_CODE);

  row.courseCode = codeMatch ? `${codeMatch[1]} ${codeMatch[2]}` : codeCell.toUpperCase();
  row.courseName = tidyName(at('name'));
  row.units = toNumber(at('units'));
  row.score = toNumber(at('score'));
  row.gradePoint = toNumber(at('qp'));
  row.qualityPoints = null;

  const grade = at('grade').toUpperCase();
  if (GRADE.test(grade)) row.gradeName = grade;

  /*
   * A "points" column is either points per unit or the course total, and sheets
   * label both the same way. The scale settles it: no per-unit grade point on a
   * 4.0 or 5.0 scale exceeds 5, so anything larger is the total for the course.
   */
  if (row.gradePoint !== null && row.units) {
    if (row.gradePoint > 5) {
      row.qualityPoints = row.gradePoint;
      row.gradePoint = row.qualityPoints / row.units;
    } else {
      row.qualityPoints = row.gradePoint * row.units;
    }
  }


  if (!row.courseCode && !row.courseName) return null;
  return row;
}

/**
 * Reads a line with no header to go by.
 *
 * The course code anchors everything: the words around it are the title, and the
 * numbers after it are units, score and points in whatever order the sheet used.
 * They are told apart by range and by arithmetic — quality points are the number
 * that equals units times another number on the line.
 */
function fromShape(line: string): ParsedResultRow | null {
  const upper = line.toUpperCase();
  const codeMatch = upper.match(COURSE_CODE);
  if (!codeMatch) return null;

  const row = blankRow();
  row.courseCode = `${codeMatch[1]} ${codeMatch[2]}`;

  const after = upper.slice((codeMatch.index ?? 0) + codeMatch[0].length);
  const tokens = after.split(/[\s,|]+/).filter(Boolean);

  const numbers: number[] = [];
  const words: string[] = [];
  for (const token of tokens) {
    if (GRADE.test(token) && !row.gradeName) {
      row.gradeName = token;
      continue;
    }
    const value = toNumber(token);
    if (value !== null) {
      numbers.push(value);
      continue;
    }
    // Once numbers have started the title is over; anything after is a remark.
    if (numbers.length === 0) words.push(token);
  }

  // Titles sometimes sit before the code instead of after it.
  const before = tidyName(line.slice(0, codeMatch.index ?? 0));
  row.courseName = words.length > 0 ? tidyName(words.join(' ')) : before;

  const unused = new Set(numbers.keys());
  const take = (predicate: (value: number) => boolean): number | null => {
    for (const index of unused) {
      if (predicate(numbers[index])) {
        unused.delete(index);
        return numbers[index];
      }
    }
    return null;
  };

  // Units first: small whole numbers, and the anchor for the points arithmetic.
  row.units = take((value) => Number.isInteger(value) && value >= 1 && value <= 12);

  /*
   * Then the mark. Once units are known, anything above what the scale could
   * possibly award for them (5 points per unit) cannot be quality points, which
   * is what separates "3 72 12" into 72 marks and 12 points. Between 12 and that
   * ceiling the two are genuinely ambiguous; points win there, because a sheet
   * carrying a mark that low almost always carries a grade letter as well, and a
   * failing mark is far rarer than a modest quality-point total.
   */
  const scoreCeiling = row.units ? 5 * row.units : 12;
  row.score = take((value) => value > scoreCeiling && value > 12 && value <= 100);

  if (row.units) {
    const units = row.units;
    // Quality points: bigger than any per-unit point, and small enough that
    // dividing by the units lands back inside the scale.
    row.qualityPoints = take((value) => value > 5 && value / units <= 5.001);


    row.gradePoint = take((value) => value <= 5);
    if (row.qualityPoints === null && row.gradePoint !== null) {
      row.qualityPoints = row.gradePoint * units;
    }
    if (row.gradePoint === null && row.qualityPoints !== null) {
      row.gradePoint = row.qualityPoints / units;
    }
  }

  return row;
}

export function parseResultText(text: string): ParseOutcome {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const notes: string[] = [];
  const rows: ParsedResultRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let header: Partial<Record<Field, number>> | null = null;

  for (const line of lines) {
    if (!header) {
      const candidate = readHeader(line);
      if (candidate) {
        header = candidate;
        continue;
      }
    }

    if (NOT_A_COURSE.test(line)) continue;

    const row = (header ? fromColumns(line, header) : null) ?? fromShape(line);

    // Nothing identifiable and nothing worth mentioning: most likely a heading.
    if (!row || (!row.courseCode && !row.courseName)) {
      if (/\d/.test(line)) skipped += 1;
      continue;
    }

    const key = (row.courseCode || row.courseName).toUpperCase();
    if (seen.has(key)) {
      notes.push(`Skipped a repeat of ${key}.`);
      continue;
    }
    seen.add(key);
    rows.push(row);
  }

  if (rows.length === 0) {
    notes.push('No course rows were recognised. Check that the text includes course codes.');
  }
  if (skipped > 0) {
    notes.push(`${skipped} line${skipped === 1 ? '' : 's'} could not be read and were left out.`);
  }
  const missingUnits = rows.filter((row) => row.units === null).length;
  if (missingUnits > 0) {
    notes.push(`${missingUnits} row${missingUnits === 1 ? '' : 's'} have no units — set them below.`);
  }

  return { rows, skipped, notes };
}
