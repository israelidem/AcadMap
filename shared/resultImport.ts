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
 * Order matters, and the order here is the result of real sheets rather than
 * taste. "Course Code" and "Course Title" both contain "course", so the specific
 * words go first. More subtly, points are tested before grades: a column headed
 * "Grade Point" holds a number, not a letter, and reading it as the grade column
 * both loses the number and leaves the real "Grade" column unclaimed — which is
 * exactly how a sheet ends up importing with no grades at all.
 */
function headerField(label: string): Field | null {
  const value = label.toLowerCase();
  if (!value) return null;
  if (/\bcodes?\b/.test(value)) return 'code';
  if (/unit|credit|\bcu\b|load/.test(value)) return 'units';
  if (/score|mark|raw|%|\btotal\b/.test(value)) return 'score';
  if (/point|\bqp\b|\bgp\b|quality|weight/.test(value)) return 'qp';
  if (/grade|letter/.test(value)) return 'grade';
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

/**
 * Sanity checks on values read by column position.
 *
 * Text lifted out of a PDF does not reliably produce one cell per column: an
 * empty cell, a wrapped title or a merged fragment shifts every cell after it.
 * When that happens the column map is still applied, and the row silently
 * imports with a mark in the units column and a figure as its title — which is
 * how a sheet of twelve courses arrives with nothing that can be saved.
 *
 * So a value has to be plausible for the field that claims it. Where it is not,
 * the value is discarded and the shape heuristic gets the row instead.
 */
const UNITS_CEILING = 12;

function plausibleUnits(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= UNITS_CEILING
    ? value
    : null;
}

function plausibleScore(value: number | null): number | null {
  return value !== null && value >= 0 && value <= 100 ? value : null;
}

/**
 * A title is words, not figures. "3", "4.00" and "" are all a shifted cell
 * rather than a course, and treating them as a name is what leaves a row
 * unsaveable while looking filled in.
 */
function plausibleName(value: string): string {
  return /[a-z]{2,}/i.test(value) ? value : '';
}

/**
 * A course code carries a number ("CSC 201", "GST102A"). A cell with letters
 * only is a title that has slid into the code column, and accepting it puts
 * "DATA STRUCTURES" in the code field and nothing in the title.
 */
function plausibleCode(value: string): string {
  const compact = value.trim();
  // Letters and digits both, so a serial number ("1") in a column the header
  // never declared cannot become the course code.
  if (!/[a-z]/i.test(compact) || !/\d/.test(compact)) return '';
  // Codes are one token, occasionally two ("CSC 201"); more than that is prose.
  return compact.split(/\s+/).length <= 2 ? compact.toUpperCase() : '';
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
  const codeMatch = codeCell.toUpperCase().match(COURSE_CODE);

  /*
   * Whether this line's cells still line up with the header.
   *
   * The code column is the test, because a course code is the one field whose
   * shape is unmistakable. If the cell the header called "code" holds no code,
   * every cell after it is displaced too — a serial number the header never
   * declared, a wrapped title, a blank — and reading the rest by position would
   * put a mark in the units column and a figure in the title. So the whole line
   * goes to the shape heuristic instead of importing a row nothing can save.
   */
  const aligned = codeMatch !== null || plausibleCode(codeCell) !== '';

  row.courseCode = codeMatch ? `${codeMatch[1]} ${codeMatch[2]}` : plausibleCode(codeCell);

  // Each value must also suit the field claiming it, so a stray cell inside an
  // otherwise aligned row is dropped rather than trusted.
  if (aligned) {
    row.courseName = plausibleName(tidyName(at('name')));
    row.units = plausibleUnits(toNumber(at('units')));
    row.score = plausibleScore(toNumber(at('score')));
  }



  const grade = at('grade').toUpperCase();
  if (GRADE.test(grade)) row.gradeName = grade;

  /*
   * Grades are the field most often lost, because text lifted out of a PDF does
   * not always produce the same number of cells on every line — an empty cell, a
   * wrapped title or a merged fragment shifts everything after it. So rather than
   * trust the column position alone, any standalone letter cell counts as the
   * grade. Nothing else in a result row looks like one.
   */
  if (!row.gradeName) {
    const loose = cells.find(
      (cell, index) =>
        index !== map.code && index !== map.name && GRADE.test(cell.trim().toUpperCase()),
    );
    if (loose) row.gradeName = loose.trim().toUpperCase();
  }

  /*
   * Where the columns gave nothing, fall back to reading the line by its shape.
   * Column mapping is the better guess when it works, but a misaligned row should
   * degrade to the heuristic rather than import blank.
   */
  const points = toNumber(at('qp'));
  const shaped = fromShape(line);

  if (shaped) {
    if (!row.courseCode) row.courseCode = shaped.courseCode;
    if (!row.courseName) row.courseName = shaped.courseName;
    if (row.units === null) row.units = shaped.units;
    if (row.score === null) row.score = shaped.score;
    if (!row.gradeName) row.gradeName = shaped.gradeName;
    if (points === null) {
      row.gradePoint = shaped.gradePoint;
      row.qualityPoints = shaped.qualityPoints;
    }
  }

  /*
   * A "points" column is either points per unit or the course total, and sheets
   * label both the same way. The scale settles it: no per-unit grade point on a
   * 4.0 or 5.0 scale exceeds 5, so anything larger is the total for the course.
   */
  if (points !== null) {
    row.gradePoint = points;
    if (row.units) {
      if (points > 5) {
        row.qualityPoints = points;
        row.gradePoint = points / row.units;
      } else {
        row.qualityPoints = points * row.units;
      }
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
