/**
 * Performance — history, target GPA and projection.
 *
 * All maths comes from shared/gpa.ts and runs client-side; projections are
 * unit-weighted rather than averages of term GPAs.
 */

import { useState } from 'react';
import { projectCgpa, requiredGpa, round } from '@shared/gpa';
import { useAcademicMetrics, useSession } from '@/lib/hooks';
import { GpaHistoryChart } from '@/components/charts';
import { Badge, Card, EmptyState, Input, PageHeader, Stat } from '@/components/ui';

export default function Performance() {
  const { user } = useSession();
  const metrics = useAcademicMetrics();

  const [targetCgpa, setTargetCgpa] = useState('');
  const [remainingUnits, setRemainingUnits] = useState('');
  const [expectedGpa, setExpectedGpa] = useState(String(round(metrics.scale * 0.9, 1)));
  const [projectionUnits, setProjectionUnits] = useState('30');

  if (!user) return null;

  const target = Number(targetCgpa);
  const remaining = Number(remainingUnits);
  const targetResult =
    target > 0 && remaining > 0
      ? requiredGpa({
          currentCgpa: metrics.cgpa,
          completedUnits: metrics.completedUnits,
          targetCgpa: Math.min(target, metrics.scale),
          remainingUnits: remaining,
          maxPoint: metrics.scale,
        })
      : null;

  const projected = projectCgpa({
    currentCgpa: metrics.cgpa,
    completedUnits: metrics.completedUnits,
    expectedGpa: Math.min(Number(expectedGpa) || 0, metrics.scale),
    remainingUnits: Math.max(0, Number(projectionUnits) || 0),
  });

  const best = metrics.history.reduce(
    (top, entry) => (entry.gpa > (top?.gpa ?? -1) ? entry : top),
    metrics.history[0] ?? null,
  );

  return (
    <>
      <PageHeader
        title="Performance"
        description="Where you stand, what you need, and what happens if your results change."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="CGPA" tone="brand" value={metrics.cgpa.toFixed(2)} sub={`of ${round(metrics.scale, 2)}`} />
        <Stat label="Current term GPA" value={metrics.termGpa.toFixed(2)} />
        <Stat label="Completed units" value={metrics.completedUnits} />
        <Stat
          label="Best term"
          value={best ? best.gpa.toFixed(2) : '—'}
          sub={best ? best.label : 'No results yet'}
        />
      </div>

      <Card
        className="mt-4"
        title="GPA history"
        description="Term GPA against the running CGPA after each term."
      >
        {metrics.history.length === 0 ? (
          <EmptyState
            title="No results recorded"
            description="Enter grades in your academic record to build your history."
          />
        ) : (
          <>
            <GpaHistoryChart history={metrics.history} scale={metrics.scale} height={280} />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Term</th>
                    <th className="py-2 pr-4 font-medium">Units</th>
                    <th className="py-2 pr-4 font-medium">GPA</th>
                    <th className="py-2 font-medium">CGPA</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.history.map((entry) => (
                    <tr key={entry.termId} className="border-t border-border">
                      <td className="py-2 pr-4">{entry.label}</td>
                      <td className="tabular py-2 pr-4">{entry.units}</td>
                      <td className="tabular py-2 pr-4">{entry.gpa.toFixed(2)}</td>
                      <td className="tabular py-2">{entry.cumulativeGpa.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="Target CGPA calculator"
          description="What average do your remaining units need to carry?"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Target CGPA"
              type="number"
              step="0.01"
              min={0}
              max={metrics.scale}
              placeholder={String(round(metrics.scale * 0.9, 2))}
              value={targetCgpa}
              onChange={(event) => setTargetCgpa(event.target.value)}
            />
            <Input
              label="Remaining units"
              type="number"
              min={1}
              placeholder="30"
              value={remainingUnits}
              onChange={(event) => setRemainingUnits(event.target.value)}
            />
          </div>
          <div className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-sm">
            {targetResult ? (
              <>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-2xl font-semibold tabular">
                    {targetResult.alreadyAchieved ? '✓' : targetResult.requiredGpa.toFixed(2)}
                  </span>
                  <Badge tone={targetResult.achievable ? 'success' : 'danger'}>
                    {targetResult.alreadyAchieved
                      ? 'Already achieved'
                      : targetResult.achievable
                        ? 'Achievable'
                        : 'Unreachable'}
                  </Badge>
                </div>
                <p className="text-muted">{targetResult.explanation}</p>
              </>
            ) : (
              <p className="text-muted">
                Enter a target CGPA and how many units you have left. Your current CGPA (
                {metrics.cgpa.toFixed(2)}) and {metrics.completedUnits} completed units are used
                automatically.
              </p>
            )}
          </div>
        </Card>

        <Card title="CGPA projection" description="Unit-weighted, not an average of term GPAs.">
          <label className="text-sm font-medium" htmlFor="expected-gpa">
            Expected GPA: <span className="tabular">{Number(expectedGpa || 0).toFixed(2)}</span>
          </label>
          <input
            id="expected-gpa"
            type="range"
            min={0}
            max={metrics.scale}
            step={0.05}
            value={expectedGpa}
            onChange={(event) => setExpectedGpa(event.target.value)}
            className="am-focus mt-2 w-full accent-[rgb(var(--am-brand))]"
          />
          <div className="mt-4">
            <Input
              label="Remaining units"
              type="number"
              min={0}
              value={projectionUnits}
              onChange={(event) => setProjectionUnits(event.target.value)}
            />
          </div>
          <div className="mt-4 rounded-xl bg-brand-soft px-4 py-3">
            <p className="text-sm text-muted">Projected CGPA</p>
            <p className="text-3xl font-semibold tabular text-brand">{projected.toFixed(2)}</p>
            <p className="mt-1 text-sm text-muted">
              Averaging {Number(expectedGpa || 0).toFixed(2)} across {projectionUnits || 0} more
              units moves you from {metrics.cgpa.toFixed(2)} to {projected.toFixed(2)}.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
