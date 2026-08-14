/**
 * Importing an uploaded result sheet.
 *
 * The student picks the file their institution gave them (or pastes the table),
 * and this pulls out course code, title, units, score and quality points, shows
 * what it found, and records the rows they confirm.
 *
 * The file never leaves the device and is never stored. It is read into memory,
 * converted to text, and dropped as soon as the text has been parsed — there is
 * no upload request and nothing written to the store but the finished records.
 * PDF reading is loaded on demand, so the bundle everyone else downloads does
 * not carry a PDF engine for a screen they may never open.
 *
 * Nothing is saved without confirmation. The parser is working with wildly
 * inconsistent layouts, so every field stays editable and the review table is
 * the point of the feature, not a formality.
 */

import { useMemo, useRef, useState } from 'react';
import { FileUp, Trash2 } from 'lucide-react';
import { gradeFromScore, gradePoint } from '@shared/grading';
import { parseResultText, type ParsedResultRow } from '@shared/resultImport';
import type { Course, GradingSystem, ID } from '@shared/types';
import { addResult } from '@/lib/actions';
import { Button, Input, Select, useToast } from '@/components/ui';

/** What the review table holds: the parse, plus the student's corrections. */
interface DraftRow extends ParsedResultRow {
  key: string;
  /** Grade chosen from the student's own grading system. */
  grade: string;
  /** Matched against a course already in the term, when one lines up. */
  courseId: ID | null;
}

const TEXT_EXTENSIONS = /\.(csv|tsv|txt|text)$/i;

/**
 * Turns a PDF into lines of text.
 *
 * PDF text arrives as positioned fragments, not lines, so fragments sharing a
 * baseline are regrouped into one line and joined with two spaces — which is what
 * the parser reads as a column break in a fixed-width table.
 */
async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const byBaseline = new Map<number, { x: number; text: string }[]>();

    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      // Rounded, because glyphs on one line differ by fractions of a point.
      const baseline = Math.round(item.transform[5]);
      const row = byBaseline.get(baseline) ?? [];
      row.push({ x: item.transform[4], text: item.str });
      byBaseline.set(baseline, row);
    }

    // Descending baseline: PDF y grows upwards, but a page reads downwards.
    for (const baseline of [...byBaseline.keys()].sort((a, b) => b - a)) {
      const row = byBaseline.get(baseline) ?? [];
      lines.push(
        row
          .sort((a, b) => a.x - b.x)
          .map((cell) => cell.text.trim())
          .filter(Boolean)
          .join('  '),
      );
    }
  }

  return lines.join('\n');
}

async function fileToText(file: File): Promise<string> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return pdfToText(file);
  if (file.type.startsWith('text/') || TEXT_EXTENSIONS.test(file.name)) return file.text();

  throw new Error(
    'That file type cannot be read. Upload a PDF, CSV or text file, or paste the table below.',
  );
}

/**
 * Which grade the sheet is describing, in the student's own grading system.
 *
 * The letter on the sheet is trusted first — it is what the institution awarded.
 * Failing that, the score is graded by the student's rules, and failing that the
 * points per unit are matched to the closest rule.
 */
function resolveGrade(system: GradingSystem, row: ParsedResultRow): string {
  if (row.gradeName && gradePoint(system, row.gradeName) !== null) return row.gradeName;

  if (row.score !== null) {
    const rule = gradeFromScore(system, row.score);
    if (rule) return rule.name;
  }

  if (row.gradePoint !== null) {
    const closest = system.rules
      .slice()
      .sort(
        (a, b) =>
          Math.abs(a.point - (row.gradePoint ?? 0)) - Math.abs(b.point - (row.gradePoint ?? 0)),
      )[0];
    if (closest && Math.abs(closest.point - row.gradePoint) <= 0.5) return closest.name;
  }

  /*
   * Nothing to go on, so nothing is chosen. Defaulting to the first rule would
   * quietly put an A against every unreadable row, and the student would have no
   * reason to look twice; an empty grade holds the row back until they pick one.
   */
  return '';
}

/** Ties a parsed row to a course already recorded in the term, if one matches. */
function matchCourse(courses: Course[], row: ParsedResultRow): Course | undefined {
  const code = row.courseCode.replace(/\s+/g, '').toUpperCase();
  const name = row.courseName.trim().toLowerCase();

  return courses.find((course) => {
    if (code && course.code.replace(/\s+/g, '').toUpperCase() === code) return true;
    return name.length > 3 && course.name.trim().toLowerCase() === name;
  });
}

export function ResultSheetImport({
  userId,
  termId,
  system,
  courses,
  onDone,
}: {
  userId: ID;
  termId: ID;
  system: GradingSystem;
  /** Courses in this term, used to link a row to a course the student already has. */
  courses: Course[];
  onDone: () => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [pasted, setPasted] = useState('');
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sourceName, setSourceName] = useState<string>();
  /** Kept only to show the student what was read when a sheet will not parse. */
  const [extracted, setExtracted] = useState('');

  const grades = system.rules.map((rule) => rule.name);

  const toDrafts = (parsed: ParsedResultRow[]): DraftRow[] =>
    parsed.map((row, index) => {
      const course = matchCourse(courses, row);
      return {
        ...row,
        key: `${row.courseCode || row.courseName}-${index}`,
        grade: resolveGrade(system, row),
        courseId: course?.id ?? null,
        units: row.units ?? course?.units ?? null,
        courseName: row.courseName || course?.name || '',
        courseCode: row.courseCode || course?.code || '',
      };
    });

  const read = (text: string, label: string) => {
    const outcome = parseResultText(text);
    setNotes(outcome.notes);
    setSourceName(label);
    setExtracted(text);

    if (outcome.rows.length === 0) {
      setRows(null);
      setError(
        'No results could be read from that. If it is a scan or a photo, type the rows in ' +
          'manually or paste the text.',
      );
      return;
    }

    setError(undefined);
    setRows(toDrafts(outcome.rows));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(undefined);

    try {
      const text = await fileToText(file);
      read(text, file.name);
    } catch (failure) {
      setRows(null);
      setError(failure instanceof Error ? failure.message : 'That file could not be read.');
    } finally {
      setBusy(false);
      // The file is dropped here: nothing holds a reference to it afterwards.
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const patch = (key: string, change: Partial<DraftRow>) => {
    setRows((current) =>
      current?.map((row) => (row.key === key ? { ...row, ...change } : row)) ?? null,
    );
  };

  const remove = (key: string) => {
    setRows((current) => current?.filter((row) => row.key !== key) ?? null);
  };

  const ready = useMemo(
    () =>
      (rows ?? []).filter(
        (row) => row.courseName.trim().length >= 2 && (row.units ?? 0) > 0 && row.grade,
      ),
    [rows],
  );

  const save = () => {
    if (ready.length === 0) {
      toast('Give every row a course name, units and a grade first.', 'error');
      return;
    }

    for (const row of ready) {
      const rule = system.rules.find((item) => item.name === row.grade);
      if (!rule) continue;

      addResult(userId, {
        termId,
        courseId: row.courseId,
        courseName: row.courseName.trim(),
        courseCode: row.courseCode.trim(),
        units: row.units as number,
        gradeName: rule.name,
        gradePoint: rule.point,
        countsInGpa: true,
        isRepeat: false,
        replacesResultId: null,
      });
    }

    toast(`${ready.length} result${ready.length === 1 ? '' : 's'} recorded.`);
    onDone();
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <input
          ref={fileInput}
          id="result-sheet"
          type="file"
          className="sr-only"
          accept=".pdf,.csv,.tsv,.txt,text/plain,text/csv,application/pdf"
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
        <Button
          variant="secondary"
          loading={busy}
          onClick={() => fileInput.current?.click()}
          className="justify-center"
        >
          <FileUp className="h-4 w-4" aria-hidden />
          {sourceName ? `Choose another file (${sourceName})` : 'Choose your result file'}
        </Button>
        <p className="am-hint">
          PDF, CSV or text. The file is read on your device, is never uploaded and is not kept —
          only the records you confirm below are saved. A photo or scan cannot be read; paste the
          text instead.
        </p>
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="result-paste">
          Or paste the table
        </label>
        <textarea
          id="result-paste"
          className="am-input min-h-[104px] font-mono text-xs"
          placeholder={'CSC 201  Data Structures  3  72  B  12'}
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
        />
        <Button
          variant="secondary"
          onClick={() => read(pasted, 'pasted text')}
          disabled={pasted.trim().length === 0}
        >
          Read pasted text
        </Button>
      </div>

      {error && <p className="am-error">{error}</p>}

      {/*
        When a sheet will not parse, the text that came out of it is far more useful
        than an apology: the student can see whether the file had readable text at
        all, and paste a corrected version straight into the box above.
      */}
      {extracted && (!rows || rows.length === 0) && (
        <details className="rounded-xl border border-border p-3 text-xs">
          <summary className="cursor-pointer font-medium">What was read from the file</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">
            {extracted.slice(0, 4000)}
          </pre>
        </details>
      )}

      {notes.length > 0 && (
        <ul className="am-hint list-disc pl-5">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {rows && rows.length > 0 && (
        <div className="grid gap-3">
          <p className="text-sm font-medium">
            Found {rows.length} course{rows.length === 1 ? '' : 's'} — check and edit before saving.
          </p>

          {/* Scrolls sideways on a phone rather than pushing the page off screen. */}
          <div className="am-scroll-x">

            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="pb-2 pr-2 font-medium">Code</th>
                  <th className="pb-2 pr-2 font-medium">Course</th>
                  <th className="pb-2 pr-2 font-medium">Units</th>
                  <th className="pb-2 pr-2 font-medium">Score</th>
                  <th className="pb-2 pr-2 font-medium">Grade</th>
                  <th className="pb-2 pr-2 font-medium">QP</th>
                  <th className="pb-2" aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const rule = system.rules.find((item) => item.name === row.grade);
                  const qualityPoints =
                    rule && row.units ? Math.round(rule.point * row.units * 100) / 100 : null;

                  return (
                    <tr key={row.key} className="border-t border-border align-top">
                      <td className="py-2 pr-2">
                        <Input
                          aria-label="Course code"
                          value={row.courseCode}
                          onChange={(event) => patch(row.key, { courseCode: event.target.value })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          aria-label="Course title"
                          value={row.courseName}
                          onChange={(event) => patch(row.key, { courseName: event.target.value })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          aria-label="Units"
                          type="number"
                          min={1}
                          value={row.units ?? ''}
                          onChange={(event) =>
                            patch(row.key, {
                              units: event.target.value === '' ? null : Number(event.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="py-2 pr-2 text-muted">{row.score ?? '—'}</td>
                      <td className="py-2 pr-2">
                        <Select
                          aria-label="Grade"
                          value={row.grade}
                          onChange={(event) => patch(row.key, { grade: event.target.value })}
                        >
                          {/* Unread grades stay empty rather than defaulting to a pass. */}
                          <option value="">Choose…</option>
                          {grades.map((grade) => (
                            <option key={grade} value={grade}>
                              {grade}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-2 pr-2 text-muted">{qualityPoints ?? '—'}</td>
                      <td className="py-2">
                        <Button
                          variant="ghost"
                          aria-label={`Remove ${row.courseCode || row.courseName}`}
                          onClick={() => remove(row.key)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Button onClick={save} disabled={ready.length === 0}>
            Add {ready.length} record{ready.length === 1 ? '' : 's'}
          </Button>
        </div>
      )}
    </div>
  );
}
