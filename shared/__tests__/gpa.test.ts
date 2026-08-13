import { describe, expect, it } from 'vitest';
import { computeGpa, projectCgpa, qualityPoints, requiredGpa } from '../gpa';
import { computeStreak } from '../streak';
import type { StudySession } from '../types';

describe('computeGpa', () => {
  it('divides total quality points by total units', () => {
    // 3×5 + 2×4 = 23 quality points over 5 units → 4.6
    const result = computeGpa([
      { units: 3, gradePoint: 5 },
      { units: 2, gradePoint: 4 },
    ]);
    expect(result.qualityPoints).toBe(23);
    expect(result.totalUnits).toBe(5);
    expect(result.gpa).toBe(4.6);
  });

  it('ignores entries excluded from the GPA', () => {
    const result = computeGpa([
      { units: 3, gradePoint: 5 },
      { units: 3, gradePoint: 0, countsInGpa: false },
    ]);
    expect(result.totalUnits).toBe(3);
    expect(result.gpa).toBe(5);
    expect(result.countedCourses).toBe(1);
  });

  it('returns zero rather than NaN with no courses', () => {
    expect(computeGpa([]).gpa).toBe(0);
  });

  it('computes quality points as units × grade point', () => {
    expect(qualityPoints(4, 3.5)).toBe(14);
  });
});

describe('requiredGpa', () => {
  it('explains the average needed across remaining units', () => {
    const result = requiredGpa({
      currentCgpa: 4.3,
      completedUnits: 60,
      targetCgpa: 4.5,
      remainingUnits: 60,
      maxPoint: 5,
    });
    expect(result.achievable).toBe(true);
    expect(result.requiredGpa).toBe(4.7);
    expect(result.explanation).toContain('4.7');
  });

  it('flags mathematically unreachable targets', () => {
    const result = requiredGpa({
      currentCgpa: 2,
      completedUnits: 100,
      targetCgpa: 4.9,
      remainingUnits: 10,
      maxPoint: 5,
    });
    expect(result.achievable).toBe(false);
    expect(result.explanation).toMatch(/unreachable/i);
  });

  it('recognises a target already banked by completed units', () => {
    // 4.8×90 = 432 points; a 4.0 CGPA over 100 units only needs 400.
    const result = requiredGpa({
      currentCgpa: 4.8,
      completedUnits: 90,
      targetCgpa: 4.0,
      remainingUnits: 10,
      maxPoint: 5,
    });
    expect(result.alreadyAchieved).toBe(true);
    expect(result.requiredGpa).toBe(0);
  });
});

describe('projectCgpa', () => {
  it('weights by credit units instead of averaging term GPAs', () => {
    // 4.2×90 + 4.7×30 = 519 points over 120 units → 4.33 (not (4.2+4.7)/2)
    expect(
      projectCgpa({ currentCgpa: 4.2, completedUnits: 90, expectedGpa: 4.7, remainingUnits: 30 }),
    ).toBe(4.33);
  });
});

describe('computeStreak', () => {
  const session = (date: string, status: StudySession['status']): StudySession =>
    ({
      id: `s-${date}-${status}`,
      userId: 'u1',
      courseId: 'c1',
      topicId: null,
      date,
      startTime: '17:00',
      endTime: '18:00',
      status,
    }) as StudySession;

  it('counts consecutive days with a completed session', () => {
    const streak = computeStreak(
      [
        session('2026-03-02', 'COMPLETED'),
        session('2026-03-03', 'COMPLETED'),
        session('2026-03-04', 'COMPLETED'),
      ],
      '2026-03-04',
    );
    expect(streak.current).toBe(3);
  });

  it('does not reward merely scheduled or skipped sessions', () => {
    const streak = computeStreak(
      [session('2026-03-03', 'SCHEDULED'), session('2026-03-04', 'SKIPPED')],
      '2026-03-04',
    );
    expect(streak.current).toBe(0);
  });
});
