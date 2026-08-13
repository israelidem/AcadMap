/** Academic years, terms and recorded results with term GPA / CGPA. */

import { useMemo, useState } from 'react';
import { CalendarPlus, GraduationCap, Plus, Trash2 } from 'lucide-react';
import { cgpa, round, termGpa } from '@shared/gpa';
import { maxPoint } from '@shared/grading';
import type { Course, Result } from '@shared/types';
import {
  addResult,
  createAcademicYear,
  createTerm,
  deleteAcademicYear,
  deleteResult,
  deleteTerm,
  updateTerm,
} from '@/lib/actions';
import { useGradingSystem, useSession, useUserData } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  Stat,
  Toggle,
  useToast,
} from '@/components/ui';

export default function AcademicRecord() {
  const { user } = useSession();
  const toast = useToast();
  const system = useGradingSystem();
  const { years, terms, courses, results } = useUserData(user?.id ?? null);

  const [yearOpen, setYearOpen] = useState(false);
  const [yearLabel, setYearLabel] = useState('');
  const [termOpen, setTermOpen] = useState<string | null>(null);
  const [termLabel, setTermLabel] = useState('');
  const [resultTermId, setResultTermId] = useState<string | null>(null);

  const overall = useMemo(() => cgpa(results), [results]);
  const scale = maxPoint(system);

  if (!user) return null;

  const addYear = () => {
    const label = yearLabel.trim();
    if (label.length < 4) {
      toast('Give the year a label, e.g. 2026/2027.', 'error');
      return;
    }
    createAcademicYear(user.id, label, Number(label.slice(0, 4)) || new Date().getFullYear());
    setYearLabel('');
    setYearOpen(false);
    toast('Academic year created.');
  };

  const addTerm = (yearId: string) => {
    const label = termLabel.trim();
    if (label.length < 2) {
      toast('Give the term a label.', 'error');
      return;
    }
    const position = terms.filter((term) => term.academicYearId === yearId).length + 1;
    createTerm(user.id, yearId, label, position);
    setTermLabel('');
    setTermOpen(null);
    toast('Term created.');
  };

  return (
    <>
      <PageHeader
        title="Academic record"
        description="Your structure and results. GPA and CGPA are recalculated as you type."
        action={
          <Button size="sm" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setYearOpen(true)}>
            Add academic year
          </Button>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat
          label="CGPA"
          tone="brand"
          value={overall.gpa.toFixed(2)}
          sub={`out of ${round(scale, 2)}`}
        />
        <Stat label="Completed units" value={overall.totalUnits} />
        <Stat label="Quality points" value={round(overall.qualityPoints, 2)} />
      </div>

      {years.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-6 w-6" />}
          title="No academic years yet"
          description="Start with an academic year such as 2026/2027, then add its terms."
          action={<Button onClick={() => setYearOpen(true)}>Add academic year</Button>}
        />
      ) : (
        <div className="grid gap-4">
          {years.map((year) => {
            const yearTerms = terms.filter((term) => term.academicYearId === year.id);
            return (
              <Card
                key={year.id}
                title={
                  <span className="flex items-center gap-2">
                    {year.label}
                    {year.isCurrent && <Badge tone="brand">Current</Badge>}
                  </span>
                }
                description={`${yearTerms.length} term(s)`}
                action={
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Plus className="h-4 w-4" />}
                      onClick={() => setTermOpen(year.id)}
                    >
                      Add term
                    </Button>
                    <ConfirmButton
                      title="Delete academic year?"
                      body="This deletes its terms, courses, topics and results. This cannot be undone."
                      confirmLabel="Delete year"
                      onConfirm={() => {
                        deleteAcademicYear(user.id, year.id);
                        toast('Academic year deleted.');
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                }
              >
                {yearTerms.length === 0 ? (
                  <p className="text-sm text-muted">No terms in this year yet.</p>
                ) : (
                  <div className="grid gap-3">
                    {yearTerms.map((term) => {
                      const breakdown = termGpa(results, term.id);
                      const termResults = results.filter((result) => result.termId === term.id);
                      return (
                        <div key={term.id} className="rounded-xl border border-border px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-medium">{term.label}</h3>
                            {term.isCurrent && <Badge tone="brand">Current</Badge>}
                            <Badge tone="neutral">
                              GPA {breakdown.gpa.toFixed(2)} · {breakdown.totalUnits} units
                            </Badge>
                            <div className="ml-auto flex gap-1.5">
                              {!term.isCurrent && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => updateTerm(user.id, term.id, { isCurrent: true })}
                                >
                                  Set current
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="secondary"
                                icon={<Plus className="h-4 w-4" />}
                                onClick={() => setResultTermId(term.id)}
                              >
                                Add result
                              </Button>
                              <ConfirmButton
                                title="Delete term?"
                                body="Its courses, topics and results will be deleted."
                                confirmLabel="Delete term"
                                onConfirm={() => {
                                  deleteTerm(user.id, term.id);
                                  toast('Term deleted.');
                                }}
                              >
                                Delete
                              </ConfirmButton>
                            </div>
                          </div>

                          {termResults.length > 0 && (
                            <ul className="mt-3 divide-y divide-border">
                              {termResults.map((result) => (
                                <li key={result.id} className="flex items-center gap-3 py-2 text-sm">
                                  <span className="min-w-0 flex-1 truncate">
                                    {result.courseName}
                                    {result.courseCode && (
                                      <span className="text-muted"> · {result.courseCode}</span>
                                    )}
                                  </span>
                                  <span className="tabular text-muted">{result.units}u</span>
                                  <Badge>{result.gradeName}</Badge>
                                  <span className="tabular text-muted">
                                    {round(result.units * result.gradePoint, 2)} qp
                                  </span>
                                  {!result.countsInGpa && <Badge tone="warning">Excluded</Badge>}
                                  {result.isRepeat && <Badge tone="brand">Repeat</Badge>}
                                  <button
                                    type="button"
                                    aria-label="Delete result"
                                    className="am-touch grid place-items-center rounded-xl text-danger hover:bg-surface-2"
                                    onClick={() => deleteResult(user.id, result.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={yearOpen}
        onClose={() => setYearOpen(false)}
        title="Add academic year"
        footer={
          <>
            <Button variant="secondary" onClick={() => setYearOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addYear}>Add year</Button>
          </>
        }
      >
        <Input
          label="Label"
          placeholder="2026/2027"
          value={yearLabel}
          onChange={(event) => setYearLabel(event.target.value)}
        />
      </Modal>

      <Modal
        open={termOpen !== null}
        onClose={() => setTermOpen(null)}
        title="Add term"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTermOpen(null)}>
              Cancel
            </Button>
            <Button onClick={() => termOpen && addTerm(termOpen)}>Add term</Button>
          </>
        }
      >
        <Input
          label="Label"
          placeholder="First Semester"
          value={termLabel}
          onChange={(event) => setTermLabel(event.target.value)}
          hint="Semesters, trimesters, quarters — whatever your institution uses."
        />
      </Modal>

      <ResultModal
        termId={resultTermId}
        onClose={() => setResultTermId(null)}
        courses={courses}
        results={results}
      />
    </>
  );
}

function ResultModal({
  termId,
  onClose,
  courses,
  results,
}: {
  termId: string | null;
  onClose: () => void;
  courses: Course[];
  results: Result[];
}) {
  const { user } = useSession();
  const system = useGradingSystem();
  const toast = useToast();

  const [courseId, setCourseId] = useState('');
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [units, setUnits] = useState('3');
  const [gradeName, setGradeName] = useState(system.rules[0]?.name ?? '');
  const [countsInGpa, setCountsInGpa] = useState(true);
  const [isRepeat, setIsRepeat] = useState(false);
  const [replacesResultId, setReplacesResultId] = useState('');

  if (!user || !termId) return null;

  const termCourses = courses.filter((course) => course.termId === termId);
  const earlier = results.filter((result) => result.termId !== termId);

  const pickCourse = (id: string) => {
    setCourseId(id);
    const course = termCourses.find((item) => item.id === id);
    if (course) {
      setCourseName(course.name);
      setCourseCode(course.code);
      setUnits(String(course.units));
    }
  };

  const save = () => {
    const rule = system.rules.find((item) => item.name === gradeName);
    const parsedUnits = Number(units);
    if (!rule || !Number.isFinite(parsedUnits) || parsedUnits <= 0 || courseName.trim().length < 2) {
      toast('Enter a course name, valid units and a grade.', 'error');
      return;
    }

    addResult(user.id, {
      termId,
      courseId: courseId || null,
      courseName: courseName.trim(),
      courseCode: courseCode.trim(),
      units: parsedUnits,
      gradeName: rule.name,
      gradePoint: rule.point,
      countsInGpa,
      isRepeat,
      replacesResultId: isRepeat && replacesResultId ? replacesResultId : null,
    });

    setCourseId('');
    setCourseName('');
    setCourseCode('');
    setUnits('3');
    setIsRepeat(false);
    setReplacesResultId('');
    toast('Result recorded.');
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Record result"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save result</Button>
        </>
      }
    >
      <div className="grid gap-4">
        {termCourses.length > 0 && (
          <Select label="From a course in this term" value={courseId} onChange={(event) => pickCourse(event.target.value)}>
            <option value="">Enter manually…</option>
            {termCourses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name} {course.code && `(${course.code})`}
              </option>
            ))}
          </Select>
        )}
        <Input
          label="Course name"
          value={courseName}
          onChange={(event) => setCourseName(event.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Code" value={courseCode} onChange={(event) => setCourseCode(event.target.value)} />
          <Input
            label="Units"
            type="number"
            min={0}
            max={30}
            step="0.5"
            value={units}
            onChange={(event) => setUnits(event.target.value)}
          />
          <Select label="Grade" value={gradeName} onChange={(event) => setGradeName(event.target.value)}>
            {system.rules.map((rule) => (
              <option key={rule.id} value={rule.name}>
                {rule.name} ({rule.point})
              </option>
            ))}
          </Select>
        </div>
        <Toggle checked={countsInGpa} onChange={setCountsInGpa} label="Counts towards GPA" />
        <Toggle checked={isRepeat} onChange={setIsRepeat} label="This is a repeat attempt" />
        {isRepeat && earlier.length > 0 && (
          <Select
            label="Replaces earlier attempt (optional)"
            value={replacesResultId}
            onChange={(event) => setReplacesResultId(event.target.value)}
            hint="The replaced attempt is excluded from GPA and CGPA."
          >
            <option value="">Don’t replace anything</option>
            {earlier.map((result) => (
              <option key={result.id} value={result.id}>
                {result.courseName} — {result.gradeName}
              </option>
            ))}
          </Select>
        )}
      </div>
    </Modal>
  );
}
