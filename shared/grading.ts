import type { GradeRule, GradingSystem } from './types.js';

const rule = (name: string, point: number, minScore: number | null = null): GradeRule => ({
  id: `${name}-${point}`,
  name,
  point,
  minScore,
});

export const PRESET_4_RULES: GradeRule[] = [
  rule('A', 4, 70),
  rule('B', 3, 60),
  rule('C', 2, 50),
  rule('D', 1, 45),
  rule('F', 0, 0),
];

export const PRESET_5_RULES: GradeRule[] = [
  rule('A', 5, 70),
  rule('B', 4, 60),
  rule('C', 3, 50),
  rule('D', 2, 45),
  rule('E', 1, 40),
  rule('F', 0, 0),
];

export const PRESET_GRADING_SYSTEMS: GradingSystem[] = [
  {
    id: 'preset-5',
    userId: null,
    name: '5.0 scale',
    scale: 5,
    isPreset: true,
    rules: PRESET_5_RULES,
  },
  {
    id: 'preset-4',
    userId: null,
    name: '4.0 scale',
    scale: 4,
    isPreset: true,
    rules: PRESET_4_RULES,
  },
];

export function findPreset(id: string): GradingSystem | undefined {
  return PRESET_GRADING_SYSTEMS.find((s) => s.id === id);
}

/** Highest grade point defined by the system (falls back to `scale`). */
export function maxPoint(system: GradingSystem): number {
  const highest = system.rules.reduce((max, r) => Math.max(max, r.point), 0);
  return highest > 0 ? highest : system.scale;
}

export function gradePoint(system: GradingSystem, gradeName: string): number | null {
  const found = system.rules.find(
    (r) => r.name.toLowerCase() === gradeName.trim().toLowerCase(),
  );
  return found ? found.point : null;
}

/** Resolve a grade from a raw score using the configured `minScore` thresholds. */
export function gradeFromScore(system: GradingSystem, score: number): GradeRule | null {
  const ordered = [...system.rules]
    .filter((r) => r.minScore !== null)
    .sort((a, b) => (b.minScore ?? 0) - (a.minScore ?? 0));
  return ordered.find((r) => score >= (r.minScore ?? 0)) ?? null;
}

/** Degree classification, used only for display. */
export function classification(cgpa: number, scale: number): string {
  const pct = scale > 0 ? cgpa / scale : 0;
  if (pct >= 0.9) return 'First Class';
  if (pct >= 0.7) return 'Second Class Upper';
  if (pct >= 0.5) return 'Second Class Lower';
  if (pct >= 0.4) return 'Third Class';
  if (pct > 0) return 'Pass';
  return '—';
}
