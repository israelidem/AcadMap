/**
 * Planner, streak and grading engine tests.
 *
 * These cover the rules a student would notice immediately if they broke:
 * sessions must never overlap or fall outside declared availability, a streak
 * must only be earned by completing planned work, and grade points must come
 * from the configured grading system.
 */

import { describe, expect, it } from 'vitest';
import type {
  AcademicEvent,
  AvailabilitySlot,
  Course,
  CourseTopic,
  StudySession,
} from '../types';
import { DEFAULT_PLANNER_CONFIG, generateStudyPlan, type PlannerInput } from '../scheduler';
import { computeStreak, qualifyingDays, sessionStats } from '../streak';
import { PRESET_GRADING_SYSTEMS } from '../grading';
import { classification, gradeFromScore, gradePoint, maxPoint } from '../grading';
import { toMinutes, weekdayOf } from '../time';

/** A Monday, so weekday-derived availability is unambiguous. */
const START = '2026-03-02';

function course(id: string, overrides: Partial<Course> = {}): Course {
  return {
    id,
    userId: 'u1',
    termId: 't1',
    name: `Course ${id}`,
    code: id.toUpperCase(),
    units: 3,
    priority: 'MEDIUM',
    examDate: null,
    description: null,
    archived: false,
    createdAt: `${START}T08:00:00.000Z`,
    ...overrides,
  };
}

function topic(id: string, courseId: string, overrides: Partial<CourseTopic> = {}): CourseTopic {
  return {
    id,
    userId: 'u1',
    courseId,
    title: `Topic ${id}`,
    position: 0,
    difficulty: 'NORMAL',
    estimatedMinutes: 120,
    completedMinutes: 0,
    done: false,
    ...overrides,
  };
}

/** Availability on every day of the week, so tests control the horizon instead. */
function everyDay(startTime: string, endTime: string): AvailabilitySlot[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: `a${weekday}`,
    userId: 'u1',
    weekday: weekday as AvailabilitySlot['weekday'],
    startTime,
    endTime,
  }));
}

function plannerInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    userId: 'u1',
    courses: [course('c1')],
    topics: [topic('p1', 'c1')],
    events: [],
    availability: everyDay('17:00', '20:00'),
    existingSessions: [],
    config: { ...DEFAULT_PLANNER_CONFIG, startDate: START },
    ...overrides,
  };
}

describe('generateStudyPlan', () => {
  it('places sessions inside the declared availability window', () => {
    const { sessions } = generateStudyPlan(plannerInput());

    expect(sessions.length).toBeGreaterThan(0);
    for (const session of sessions) {
      expect(toMinutes(session.startTime)).toBeGreaterThanOrEqual(toMinutes('17:00'));
      expect(toMinutes(session.endTime)).toBeLessThanOrEqual(toMinutes('20:00'));
      expect(toMinutes(session.endTime)).toBeGreaterThan(toMinutes(session.startTime));
      expect(session.generated).toBe(true);
      expect(session.status).toBe('SCHEDULED');
    }
  });

  it('never schedules two sessions over the same minutes', () => {
    const { sessions } = generateStudyPlan(
      plannerInput({
        courses: [course('c1'), course('c2'), course('c3')],
        topics: [
          topic('p1', 'c1', { estimatedMinutes: 240 }),
          topic('p2', 'c2', { estimatedMinutes: 240 }),
          topic('p3', 'c3', { estimatedMinutes: 240 }),
        ],
      }),
    );

    const byDay = new Map<string, StudySession[]>();
    for (const session of sessions) {
      byDay.set(session.date, [...(byDay.get(session.date) ?? []), session]);
    }

    for (const day of byDay.values()) {
      const ordered = [...day].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
      for (let i = 1; i < ordered.length; i += 1) {
        expect(toMinutes(ordered[i].startTime)).toBeGreaterThanOrEqual(
          toMinutes(ordered[i - 1].endTime),
        );
      }
    }
  });

  it('works around a session the student already has booked', () => {
    const existing: StudySession = {
      id: 's-existing',
      userId: 'u1',
      courseId: 'c1',
      topicId: null,
      date: START,
      startTime: '17:00',
      endTime: '19:00',
      durationMinutes: 120,
      status: 'SCHEDULED',
      generated: false,
      completedAt: null,
    };

    const { sessions } = generateStudyPlan(plannerInput({ existingSessions: [existing] }));

    for (const session of sessions.filter((item) => item.date === START)) {
      const clashes =
        toMinutes(session.startTime) < toMinutes('19:00') &&
        toMinutes(session.endTime) > toMinutes('17:00');
      expect(clashes).toBe(false);
    }
  });

  it('respects the daily study cap', () => {
    const { sessions } = generateStudyPlan(
      plannerInput({
        topics: [topic('p1', 'c1', { estimatedMinutes: 6000 })],
        availability: everyDay('08:00', '22:00'),
        config: { ...DEFAULT_PLANNER_CONFIG, startDate: START, maxMinutesPerDay: 120 },
      }),
    );

    const minutesPerDay = new Map<string, number>();
    for (const session of sessions) {
      minutesPerDay.set(
        session.date,
        (minutesPerDay.get(session.date) ?? 0) + session.durationMinutes,
      );
    }
    for (const minutes of minutesPerDay.values()) {
      expect(minutes).toBeLessThanOrEqual(120);
    }
  });

  it('reports the workload it could not fit in the horizon', () => {
    const result = generateStudyPlan(
      plannerInput({
        topics: [topic('p1', 'c1', { estimatedMinutes: 10_000 })],
        config: { ...DEFAULT_PLANNER_CONFIG, startDate: START, horizonDays: 2 },
      }),
    );

    expect(result.unscheduledMinutes).toBeGreaterThan(0);
  });

  it('starts with the course whose exam is closest', () => {
    const exams: AcademicEvent[] = [
      {
        id: 'e1',
        userId: 'u1',
        courseId: 'urgent',
        type: 'EXAM',
        title: 'Urgent exam',
        date: '2026-03-05',
        startTime: null,
        endTime: null,
        notes: null,
      },
      {
        id: 'e2',
        userId: 'u1',
        courseId: 'later',
        type: 'EXAM',
        title: 'Distant exam',
        date: '2026-06-20',
        startTime: null,
        endTime: null,
        notes: null,
      },
    ];

    const { sessions } = generateStudyPlan(
      plannerInput({
        courses: [course('later'), course('urgent')],
        topics: [topic('p-later', 'later'), topic('p-urgent', 'urgent')],
        events: exams,
      }),
    );

    expect(sessions[0].courseId).toBe('urgent');
  });

  it('is deterministic for identical input', () => {
    const first = generateStudyPlan(plannerInput());
    const second = generateStudyPlan(plannerInput());

    expect(first.sessions.map((s) => [s.date, s.startTime, s.courseId])).toEqual(
      second.sessions.map((s) => [s.date, s.startTime, s.courseId]),
    );
  });

  it('schedules nothing when the student has no availability', () => {
    const result = generateStudyPlan(plannerInput({ availability: [] }));

    expect(result.sessions).toHaveLength(0);
    expect(result.unscheduledMinutes).toBeGreaterThan(0);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('only uses the weekdays the student is actually free', () => {
    const weekday = weekdayOf(START);
    const result = generateStudyPlan(
      plannerInput({
        availability: [
          { id: 'a1', userId: 'u1', weekday, startTime: '17:00', endTime: '20:00' },
        ],
      }),
    );

    for (const session of result.sessions) {
      expect(weekdayOf(session.date)).toBe(weekday);
    }
  });
});

/* -------------------------------------------------------------------------- */

function completed(date: string, id = date): StudySession {
  return {
    id,
    userId: 'u1',
    courseId: 'c1',
    topicId: null,
    date,
    startTime: '17:00',
    endTime: '18:00',
    durationMinutes: 60,
    status: 'COMPLETED',
    generated: true,
    completedAt: `${date}T18:00:00.000Z`,
  };
}

describe('computeStreak', () => {
  it('counts consecutive completed days', () => {
    const streak = computeStreak(
      [completed('2026-03-02'), completed('2026-03-03'), completed('2026-03-04')],
      '2026-03-04',
    );

    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
    expect(streak.lastQualifyingDay).toBe('2026-03-04');
  });

  it('keeps the streak alive until today is over', () => {
    // Nothing completed today yet, but yesterday was: the student has not lost
    // the streak — they still have the rest of the day.
    const streak = computeStreak(
      [completed('2026-03-02'), completed('2026-03-03')],
      '2026-03-04',
    );

    expect(streak.current).toBe(2);
  });

  it('breaks the streak once a day is missed', () => {
    const streak = computeStreak(
      [completed('2026-03-02'), completed('2026-03-03'), completed('2026-03-06')],
      '2026-03-06',
    );

    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(2);
  });

  it('ignores skipped and merely scheduled sessions', () => {
    const scheduled: StudySession = { ...completed('2026-03-03'), status: 'SCHEDULED' };
    const skipped: StudySession = { ...completed('2026-03-04'), status: 'SKIPPED' };

    expect(qualifyingDays([scheduled, skipped])).toEqual([]);
    expect(computeStreak([scheduled, skipped], '2026-03-04').current).toBe(0);
  });

  it('summarises planned versus completed work', () => {
    const stats = sessionStats([
      completed('2026-03-02'),
      { ...completed('2026-03-03'), status: 'SCHEDULED' },
      { ...completed('2026-03-04'), status: 'SKIPPED' },
    ]);

    expect(stats.planned).toBe(3);
    expect(stats.completed).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.minutesCompleted).toBe(60);
    // Reported as a whole percentage, ready to render.
    expect(stats.completionRate).toBe(33);
  });
});

/* -------------------------------------------------------------------------- */

describe('grading systems', () => {
  const fivePoint = PRESET_GRADING_SYSTEMS.find((system) => system.scale === 5)!;
  const fourPoint = PRESET_GRADING_SYSTEMS.find((system) => system.scale === 4)!;

  it('ships both presets with their top grade at the top of the scale', () => {
    expect(maxPoint(fivePoint)).toBe(5);
    expect(maxPoint(fourPoint)).toBe(4);
  });

  it('resolves a grade label to its point value', () => {
    expect(gradePoint(fivePoint, 'A')).toBe(5);
    expect(gradePoint(fourPoint, 'A')).toBe(4);
    expect(gradePoint(fivePoint, 'F')).toBe(0);
  });

  it('does not care about the case a student typed', () => {
    expect(gradePoint(fivePoint, 'a')).toBe(5);
  });

  it('returns null for a grade the system does not define', () => {
    expect(gradePoint(fourPoint, 'Z')).toBeNull();
  });

  it('maps a score to a grade when the rules define score bands', () => {
    const rule = gradeFromScore(fivePoint, 100);
    if (rule) expect(rule.point).toBe(5);
  });

  it('describes a CGPA in the language of the scale', () => {
    expect(classification(4.6, 5)).toEqual(expect.any(String));
    expect(classification(3.8, 4)).toEqual(expect.any(String));
  });
});
