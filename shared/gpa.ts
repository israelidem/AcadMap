/**
 * GPA / CGPA calculation engine.
 *
 * Pure functions only: the client uses them for instant feedback and the API
 * re-uses them so server responses can never disagree with the UI.
 *
 *   Quality points = units × grade point
 *   GPA            = total quality points ÷ total units
 */

import type { ID, Result } from './types.js';

export interface GpaEntry {
  units: number;
  gradePoint: number;
  /** Excluded from the calculation when false. */
  countsInGpa?: boolean;
}

export interface GpaBreakdown {
  gpa: number;
  totalUnits: number;
  qualityPoints: number;
  countedCourses: number;
}

export function round(value: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function qualityPoints(units: number, gradePoint: number): number {
  return units * gradePoint;
}

export function computeGpa(entries: GpaEntry[], dp = 2): GpaBreakdown {
  let totalUnits = 0;
  let points = 0;
  let counted = 0;

  for (const entry of entries) {
    if (entry.countsInGpa === false) continue;
    if (!Number.isFinite(entry.units) || entry.units <= 0) continue;
    if (!Number.isFinite(entry.gradePoint) || entry.gradePoint < 0) continue;
    totalUnits += entry.units;
    points += qualityPoints(entry.units, entry.gradePoint);
    counted += 1;
  }

  return {
    gpa: totalUnits > 0 ? round(points / totalUnits, dp) : 0,
    totalUnits,
    qualityPoints: round(points, dp),
    countedCourses: counted,
  };
}

/**
 * Repeated courses: when a result declares `replacesResultId`, the superseded
 * attempt is dropped. Institution-specific rules (best attempt, capped grade,
 * both attempts counted) belong to a later academic-rules module.
 */
export function effectiveResults(results: Result[]): Result[] {
  const replaced = new Set<ID>();
  for (const r of results) {
    if (r.replacesResultId) replaced.add(r.replacesResultId);
  }
  return results.filter((r) => !replaced.has(r.id));
}

export function resultsToEntries(results: Result[]): GpaEntry[] {
  return effectiveResults(results).map((r) => ({
    units: r.units,
    gradePoint: r.gradePoint,
    countsInGpa: r.countsInGpa,
  }));
}

export function termGpa(results: Result[], termId: ID): GpaBreakdown {
  return computeGpa(resultsToEntries(results.filter((r) => r.termId === termId)));
}

export function cgpa(results: Result[]): GpaBreakdown {
  return computeGpa(resultsToEntries(results));
}

/* -------------------------------------------------------------------------- */
/* Targets & projections                                                      */
/* -------------------------------------------------------------------------- */

export interface RequiredGpaInput {
  currentCgpa: number;
  completedUnits: number;
  targetCgpa: number;
  remainingUnits: number;
  /** Maximum grade point of the active grading system. */
  maxPoint: number;
}

export interface RequiredGpaResult {
  requiredGpa: number;
  achievable: boolean;
  /** True when the target is already met without further work. */
  alreadyAchieved: boolean;
  explanation: string;
}

export function requiredGpa(input: RequiredGpaInput): RequiredGpaResult {
  const { currentCgpa, completedUnits, targetCgpa, remainingUnits, maxPoint } = input;

  if (remainingUnits <= 0) {
    return {
      requiredGpa: 0,
      achievable: currentCgpa >= targetCgpa,
      alreadyAchieved: currentCgpa >= targetCgpa,
      explanation:
        currentCgpa >= targetCgpa
          ? 'You have already reached this target and have no remaining units.'
          : 'With no remaining units there is no way to change your CGPA.',
    };
  }

  const targetPoints = targetCgpa * (completedUnits + remainingUnits);
  const earnedPoints = currentCgpa * completedUnits;
  const needed = (targetPoints - earnedPoints) / remainingUnits;
  const required = round(Math.max(needed, 0), 2);

  if (needed <= 0) {
    return {
      requiredGpa: 0,
      achievable: true,
      alreadyAchieved: true,
      explanation: `Your current CGPA of ${round(currentCgpa)} already meets a ${round(
        targetCgpa,
      )} target across ${completedUnits + remainingUnits} units.`,
    };
  }

  if (needed > maxPoint) {
    return {
      requiredGpa: round(needed, 2),
      achievable: false,
      alreadyAchieved: false,
      explanation: `A ${round(targetCgpa)} CGPA would require an average of ${round(
        needed,
      )} across your remaining ${remainingUnits} units, which is above the maximum of ${maxPoint} in your grading system. This target is mathematically unreachable.`,
    };
  }

  return {
    requiredGpa: required,
    achievable: true,
    alreadyAchieved: false,
    explanation: `You need an average GPA of ${required} across your remaining ${remainingUnits} units to reach a ${round(
      targetCgpa,
    )} CGPA.`,
  };
}

export interface ProjectionInput {
  currentCgpa: number;
  completedUnits: number;
  expectedGpa: number;
  remainingUnits: number;
}

/** Unit-weighted projection — never a plain average of term GPAs. */
export function projectCgpa(input: ProjectionInput): number {
  const { currentCgpa, completedUnits, expectedGpa, remainingUnits } = input;
  const totalUnits = completedUnits + remainingUnits;
  if (totalUnits <= 0) return 0;
  const points = currentCgpa * completedUnits + expectedGpa * remainingUnits;
  return round(points / totalUnits, 2);
}

export interface TermPerformance {
  termId: ID;
  label: string;
  gpa: number;
  units: number;
  cumulativeGpa: number;
  cumulativeUnits: number;
}

/** GPA history plus the running CGPA after each term, in term order. */
export function performanceHistory(
  results: Result[],
  terms: { id: ID; label: string }[],
): TermPerformance[] {
  const effective = effectiveResults(results);
  const history: TermPerformance[] = [];
  let cumulativePoints = 0;
  let cumulativeUnits = 0;

  for (const term of terms) {
    const entries = effective
      .filter((r) => r.termId === term.id)
      .map((r) => ({ units: r.units, gradePoint: r.gradePoint, countsInGpa: r.countsInGpa }));
    if (entries.length === 0) continue;

    const breakdown = computeGpa(entries);
    cumulativePoints += breakdown.qualityPoints;
    cumulativeUnits += breakdown.totalUnits;

    history.push({
      termId: term.id,
      label: term.label,
      gpa: breakdown.gpa,
      units: breakdown.totalUnits,
      cumulativeUnits,
      cumulativeGpa: cumulativeUnits > 0 ? round(cumulativePoints / cumulativeUnits, 2) : 0,
    });
  }

  return history;
}

export function gpaTrend(history: TermPerformance[]): 'UP' | 'DOWN' | 'FLAT' | 'NONE' {
  if (history.length < 2) return 'NONE';
  const last = history[history.length - 1].gpa;
  const prev = history[history.length - 2].gpa;
  if (round(last - prev, 2) > 0) return 'UP';
  if (round(last - prev, 2) < 0) return 'DOWN';
  return 'FLAT';
}
