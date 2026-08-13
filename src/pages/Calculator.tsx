/**
 * FR-001 — Guest GPA calculator.
 *
 * Entirely client-side: no API request is made, so it works for signed-out
 * visitors and costs nothing to run.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { computeGpa, round, type GpaEntry } from '@shared/gpa';
import { PRESET_4_RULES, PRESET_5_RULES } from '@shared/grading';
import type { GradeRule } from '@shared/types';
import { Badge, Button, Card, Input, Select, Stat, useToast } from '@/components/ui';
import { uid } from '@/lib/utils';

interface Row {
  id: string;
  name: string;
  units: string;
  grade: string;
}

type ScaleKind = '4.0' | '5.0' | 'custom';

interface CustomRule {
  id: string;
  name: string;
  point: string;
}

function emptyRow(): Row {
  return { id: uid('row'), name: '', units: '', grade: '' };
}

function rulesToCustom(rules: GradeRule[]): CustomRule[] {
  return rules.map((rule) => ({ id: uid('gr'), name: rule.name, point: String(rule.point) }));
}

export default function Calculator() {
  const toast = useToast();
  const [scale, setScale] = useState<ScaleKind>('5.0');
  const [customRules, setCustomRules] = useState<CustomRule[]>(() => rulesToCustom(PRESET_5_RULES));
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [calculated, setCalculated] = useState(false);

  const rules = useMemo<{ name: string; point: number }[]>(() => {
    if (scale === '4.0') return PRESET_4_RULES.map((rule) => ({ name: rule.name, point: rule.point }));
    if (scale === '5.0') return PRESET_5_RULES.map((rule) => ({ name: rule.name, point: rule.point }));
    return customRules
      .filter((rule) => rule.name.trim().length > 0)
      .map((rule) => ({ name: rule.name.trim(), point: Number(rule.point) || 0 }));
  }, [scale, customRules]);

  const maxPoint = useMemo(
    () => rules.reduce((max, rule) => Math.max(max, rule.point), 0),
    [rules],
  );

  const entries = useMemo<GpaEntry[]>(() => {
    return rows
      .map((row) => {
        const units = Number(row.units);
        const rule = rules.find((candidate) => candidate.name === row.grade);
        if (!Number.isFinite(units) || units <= 0 || !rule) return null;
        return { units, gradePoint: rule.point } satisfies GpaEntry;
      })
      .filter((entry): entry is GpaEntry => entry !== null);
  }, [rows, rules]);

  const breakdown = useMemo(() => computeGpa(entries), [entries]);
  const incomplete = rows.length - entries.length;

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const reset = () => {
    setRows([emptyRow(), emptyRow(), emptyRow()]);
    setCalculated(false);
  };

  const calculate = () => {
    if (entries.length === 0) {
      toast('Add at least one course with units and a grade.', 'error');
      return;
    }
    setCalculated(true);
  };

  const changeScale = (next: ScaleKind) => {
    setScale(next);
    if (next === 'custom' && customRules.length === 0) setCustomRules(rulesToCustom(PRESET_5_RULES));
    // Clear grades that no longer exist on the new scale.
    setRows((current) => current.map((row) => ({ ...row, grade: '' })));
    setCalculated(false);
  };

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link to="/" className="am-touch grid place-items-center rounded-xl text-muted hover:bg-surface-2">
            <ArrowLeft className="h-5 w-5" />
            <span className="sr-only">Back to home</span>
          </Link>
          <h1 className="font-semibold">GPA calculator</h1>
          <Badge tone="brand">No account needed</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="GPA"
            tone="brand"
            value={calculated ? breakdown.gpa.toFixed(2) : '—'}
            sub={maxPoint > 0 ? `out of ${round(maxPoint, 2)}` : undefined}
          />
          <Stat label="Total units" value={calculated ? breakdown.totalUnits : '—'} />
          <Stat
            label="Quality points"
            value={calculated ? round(breakdown.qualityPoints, 2) : '—'}
          />
        </div>

        <Card
          className="mt-4"
          title="Grading scale"
          description="Pick a preset or define your own grades and points."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Scale"
              value={scale}
              onChange={(event) => changeScale(event.target.value as ScaleKind)}
            >
              <option value="4.0">4.0 scale</option>
              <option value="5.0">5.0 scale</option>
              <option value="custom">Custom scale</option>
            </Select>
            <div className="flex flex-wrap items-end gap-1.5">
              {rules.map((rule) => (
                <Badge key={rule.name}>
                  {rule.name} = {rule.point}
                </Badge>
              ))}
            </div>
          </div>

          {scale === 'custom' && (
            <div className="mt-4 grid gap-2">
              {customRules.map((rule) => (
                <div key={rule.id} className="flex items-end gap-2">
                  <Input
                    label="Grade"
                    className="w-full"
                    value={rule.name}
                    onChange={(event) =>
                      setCustomRules((current) =>
                        current.map((item) =>
                          item.id === rule.id ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Input
                    label="Point"
                    type="number"
                    min={0}
                    step="0.01"
                    value={rule.point}
                    onChange={(event) =>
                      setCustomRules((current) =>
                        current.map((item) =>
                          item.id === rule.id ? { ...item, point: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Remove grade ${rule.name || 'row'}`}
                    className="am-touch grid place-items-center rounded-xl text-muted hover:bg-surface-2"
                    onClick={() =>
                      setCustomRules((current) => current.filter((item) => item.id !== rule.id))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                className="justify-self-start"
                icon={<Plus className="h-4 w-4" />}
                onClick={() =>
                  setCustomRules((current) => [...current, { id: uid('gr'), name: '', point: '' }])
                }
              >
                Add grade
              </Button>
            </div>
          )}
        </Card>

        <Card
          className="mt-4"
          title="Courses"
          description="Quality points = units × grade point. GPA = total quality points ÷ total units."
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setRows((current) => [...current, emptyRow()])}
            >
              Add course
            </Button>
          }
        >
          <div className="grid gap-3">
            {rows.map((row, index) => {
              const rule = rules.find((candidate) => candidate.name === row.grade);
              const units = Number(row.units);
              const qp = rule && units > 0 ? units * rule.point : null;

              return (
                <div
                  key={row.id}
                  className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_7rem_9rem_5rem_2.5rem] sm:items-end sm:border-0 sm:p-0"
                >
                  <Input
                    label={index === 0 ? 'Course name' : undefined}
                    placeholder="e.g. Constitutional Law"
                    value={row.name}
                    onChange={(event) => setRow(row.id, { name: event.target.value })}
                  />
                  <Input
                    label={index === 0 ? 'Units' : undefined}
                    type="number"
                    min={0}
                    max={30}
                    step="0.5"
                    placeholder="3"
                    value={row.units}
                    onChange={(event) => setRow(row.id, { units: event.target.value })}
                  />
                  <Select
                    label={index === 0 ? 'Grade' : undefined}
                    value={row.grade}
                    onChange={(event) => setRow(row.id, { grade: event.target.value })}
                  >
                    <option value="">Select…</option>
                    {rules.map((option) => (
                      <option key={option.name} value={option.name}>
                        {option.name} ({option.point})
                      </option>
                    ))}
                  </Select>
                  <div className="text-sm text-muted sm:pb-3">
                    <span className="sm:hidden">Quality points: </span>
                    <span className="tabular">{qp === null ? '—' : round(qp, 2)}</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove course"
                    className="am-touch grid place-items-center justify-self-start rounded-xl text-muted hover:bg-surface-2 sm:mb-1"
                    onClick={() =>
                      setRows((current) =>
                        current.length === 1 ? [emptyRow()] : current.filter((item) => item.id !== row.id),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {incomplete > 0 && (
            <p className="am-hint mt-3">
              {incomplete} row{incomplete === 1 ? '' : 's'} will be ignored until units and a grade are
              set.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={calculate}>Calculate GPA</Button>
            <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={reset}>
              Reset
            </Button>
          </div>
        </Card>

        <div className="am-card mt-4 px-5 py-5 text-center">
          <p className="text-sm text-muted">
            Create a free AcadMap account to save your academic record, track CGPA across terms and
            generate a study plan.
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <Link to="/register">
              <Button>Create free account</Button>
            </Link>
            <Link to="/login">
              <Button variant="secondary">Log in</Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
