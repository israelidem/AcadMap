/**
 * Automatic study planner.
 *
 * The planner turns academic workload (courses → topics) plus the student's
 * declared availability into concrete, non-overlapping study sessions.
 *
 * Scoring considers, in order of influence:
 *   1. Deadline proximity (exam date / assignment due date)
 *   2. Course priority
 *   3. Topic difficulty
 *   4. Remaining workload
 * Allocation then respects available study time, existing commitments and
 * progress already completed.
 *
 * Pure and deterministic: the same input always produces the same plan, which
 * makes it testable and lets the API and the client agree.
 */

import type {
  AcademicEvent,
  AvailabilitySlot,
  Course,
  CourseTopic,
  DateStr,
  ID,
  StudySession,
} from './types';
import { addDays, daysBetween, overlaps, toMinutes, toTimeStr, weekdayOf } from './time';

export interface PlannerConfig {
  /** First day the planner may schedule on. */
  startDate: DateStr;
  /** How many days ahead to plan. */
  horizonDays: number;
  /** Preferred session length in minutes. */
  sessionMinutes: number;
  /** Gap inserted between two consecutive sessions. */
  breakMinutes: number;
  /** Cap on scheduled study minutes per day. */
  maxMinutesPerDay: number;
  /** Max distinct sessions per course per day (keeps variety). */
  maxSessionsPerCoursePerDay: number;
}

export const DEFAULT_PLANNER_CONFIG: Omit<PlannerConfig, 'startDate'> = {
  horizonDays: 14,
  sessionMinutes: 60,
  breakMinutes: 15,
  maxMinutesPerDay: 240,
  maxSessionsPerCoursePerDay: 1,
};

export interface PlannerInput {
  userId: ID;
  courses: Course[];
  topics: CourseTopic[];
  events: AcademicEvent[];
  availability: AvailabilitySlot[];
  /** Sessions that already exist; completed/scheduled ones block their slot. */
  existingSessions: StudySession[];
  config: PlannerConfig;
}

export interface PlannerResult {
  sessions: StudySession[];
  /** Minutes of work that could not be placed within the horizon. */
  unscheduledMinutes: number;
  /** Human-readable notes explaining planner decisions. */
  notes: string[];
}

const PRIORITY_WEIGHT = { HIGH: 1.5, MEDIUM: 1.15, LOW: 1 } as const;
const DIFFICULTY_WEIGHT = { HARD: 1.4, NORMAL: 1.1, EASY: 1 } as const;

/**
 * Revision minutes assumed per credit unit for a course with no topics yet.
 *
 * Breaking a course into topics is the better input, but most students add
 * courses and availability and expect a plan straight away. One hour of
 * revision per credit unit over the horizon is a conservative default that
 * produces a usable schedule without inventing topic names.
 */
export const MINUTES_PER_UNIT = 60;

interface WorkItem {
  courseId: ID;
  /** Null for course-level work, i.e. a course that has no topics. */
  topicId: ID | null;
  title: string;
  remainingMinutes: number;
  deadline: DateStr | null;
  score: number;
}


interface FreeInterval {
  date: DateStr;
  start: number;
  end: number;
}

/** Nearest exam/assignment/test date for a course, if any. */
function courseDeadline(course: Course, events: AcademicEvent[]): DateStr | null {
  const dates = events
    .filter((e) => e.courseId === course.id && e.type !== 'OTHER')
    .map((e) => e.date);
  if (course.examDate) dates.push(course.examDate);
  if (dates.length === 0) return null;
  return dates.sort()[0];
}

/** Urgency multiplier: closer deadlines dominate the ordering. */
function urgency(deadline: DateStr | null, today: DateStr): number {
  if (!deadline) return 1;
  const days = daysBetween(today, deadline);
  if (days < 0) return 0.5; // already passed — deprioritise, don't discard
  if (days === 0) return 6;
  return 1 + 5 / (1 + days);
}

export function buildWorkItems(input: PlannerInput): WorkItem[] {
  const { courses, topics, events, existingSessions, config } = input;
  const active = courses.filter((c) => !c.archived);
  const byId = new Map(active.map((c) => [c.id, c]));

  const items: WorkItem[] = [];
  for (const topic of topics) {
    const course = byId.get(topic.courseId);

    if (!course) continue;
    if (topic.done) continue;

    const remaining = Math.max(0, topic.estimatedMinutes - topic.completedMinutes);
    if (remaining <= 0) continue;

    const deadline = courseDeadline(course, events);
    const score =
      urgency(deadline, config.startDate) *
      PRIORITY_WEIGHT[course.priority] *
      DIFFICULTY_WEIGHT[topic.difficulty] *
      (1 + remaining / 600);

    items.push({
      courseId: course.id,
      topicId: topic.id,
      title: topic.title,
      remainingMinutes: remaining,
      deadline,
      score,
    });
  }

  /*
   * Course-level fallback.
   *
   * A course the student has not broken into topics still needs revising, and
   * "add courses, set availability, generate" is the path almost everyone takes
   * first. Without this the planner returned an empty plan and looked broken.
   * Minutes already completed against the course count as progress so a
   * regenerated plan does not repeat work that is done.
   */
  const coursesWithOutstandingTopics = new Set(items.map((item) => item.courseId));
  for (const course of active) {
    if (coursesWithOutstandingTopics.has(course.id)) continue;
    if (topics.some((topic) => topic.courseId === course.id)) continue; // fully covered

    const completedMinutes = existingSessions
      .filter((session) => session.courseId === course.id && session.status === 'COMPLETED')
      .reduce((sum, session) => sum + session.durationMinutes, 0);
    const remaining = Math.max(0, Math.round(course.units * MINUTES_PER_UNIT) - completedMinutes);
    if (remaining <= 0) continue;

    const deadline = courseDeadline(course, events);
    items.push({
      courseId: course.id,
      topicId: null,
      title: `${course.name} revision`,
      remainingMinutes: remaining,
      deadline,
      score:
        urgency(deadline, config.startDate) *
        PRIORITY_WEIGHT[course.priority] *
        DIFFICULTY_WEIGHT.NORMAL *
        (1 + remaining / 600),
    });
  }

  // Ties break on a stable key so the plan stays deterministic.
  const key = (item: WorkItem) => item.topicId ?? item.courseId;
  return items.sort((a, b) => b.score - a.score || key(a).localeCompare(key(b)));
}


/**
 * Expands weekly availability into concrete intervals for the horizon and
 * subtracts existing commitments (timed events and live sessions).
 */
export function buildFreeIntervals(input: PlannerInput): FreeInterval[] {
  const { availability, events, existingSessions, config } = input;
  const intervals: FreeInterval[] = [];

  for (let offset = 0; offset < config.horizonDays; offset += 1) {
    const date = addDays(config.startDate, offset);
    const weekday = weekdayOf(date);

    const busy: Array<[number, number]> = [];
    for (const event of events) {
      if (event.date !== date || !event.startTime) continue;
      const start = toMinutes(event.startTime);
      const end = event.endTime ? toMinutes(event.endTime) : start + 60;
      busy.push([start, end]);
    }
    for (const session of existingSessions) {
      if (session.date !== date) continue;
      if (session.status === 'SKIPPED' || session.status === 'RESCHEDULED') continue;
      busy.push([toMinutes(session.startTime), toMinutes(session.endTime)]);
    }

    const daySlots = availability
      .filter((slot) => slot.weekday === weekday)
      .map((slot) => ({ start: toMinutes(slot.startTime), end: toMinutes(slot.endTime) }))
      .filter((slot) => slot.end > slot.start)
      .sort((a, b) => a.start - b.start);

    for (const slot of daySlots) {
      let segments: Array<[number, number]> = [[slot.start, slot.end]];
      for (const [bStart, bEnd] of busy) {
        const next: Array<[number, number]> = [];
        for (const [sStart, sEnd] of segments) {
          if (!overlaps(sStart, sEnd, bStart, bEnd)) {
            next.push([sStart, sEnd]);
            continue;
          }
          if (bStart > sStart) next.push([sStart, Math.min(bStart, sEnd)]);
          if (bEnd < sEnd) next.push([Math.max(bEnd, sStart), sEnd]);
        }
        segments = next;
      }
      for (const [start, end] of segments) {
        if (end - start >= 30) intervals.push({ date, start, end });
      }
    }
  }

  return intervals.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

export function generateStudyPlan(input: PlannerInput): PlannerResult {
  const { config } = input;
  const notes: string[] = [];
  const items = buildWorkItems(input);
  const intervals = buildFreeIntervals(input);
  const sessions: StudySession[] = [];

  if (items.length === 0) {
    notes.push(
      'Nothing left to schedule. Add a course for this term, or mark fewer topics as done.',
    );
    return { sessions, unscheduledMinutes: 0, notes };
  }

  if (intervals.length === 0) {
    notes.push('No free study time found. Add availability in Planner → Availability.');
    return {
      sessions,
      unscheduledMinutes: items.reduce((sum, i) => sum + i.remainingMinutes, 0),
      notes,
    };
  }

  const minutesPerDay = new Map<DateStr, number>();
  const perCoursePerDay = new Map<string, number>();
  let counter = 0;

  for (const interval of intervals) {
    let cursor = interval.start;

    while (interval.end - cursor >= 30) {
      const dayUsed = minutesPerDay.get(interval.date) ?? 0;
      const dayRemaining = config.maxMinutesPerDay - dayUsed;
      if (dayRemaining < 30) break;

      const capacity = Math.min(interval.end - cursor, config.sessionMinutes, dayRemaining);
      if (capacity < 30) break;

      const candidate = items.find((item) => {
        if (item.remainingMinutes <= 0) return false;
        if (item.deadline && interval.date > item.deadline) return false;
        const key = `${item.courseId}|${interval.date}`;
        return (perCoursePerDay.get(key) ?? 0) < config.maxSessionsPerCoursePerDay;
      });

      if (!candidate) break;

      const duration = Math.min(capacity, candidate.remainingMinutes);
      if (duration < 30 && candidate.remainingMinutes >= 30) break;

      const length = Math.max(30, duration);
      counter += 1;
      sessions.push({
        id: `gen-${interval.date}-${cursor}-${counter}`,
        userId: input.userId,
        courseId: candidate.courseId,
        topicId: candidate.topicId,
        date: interval.date,
        startTime: toTimeStr(cursor),
        endTime: toTimeStr(cursor + length),
        durationMinutes: length,
        status: 'SCHEDULED',
        generated: true,
        completedAt: null,
      });

      candidate.remainingMinutes -= length;
      minutesPerDay.set(interval.date, dayUsed + length);
      const key = `${candidate.courseId}|${interval.date}`;
      perCoursePerDay.set(key, (perCoursePerDay.get(key) ?? 0) + 1);
      cursor += length + config.breakMinutes;
    }
  }

  const unscheduledMinutes = items.reduce((sum, item) => sum + item.remainingMinutes, 0);

  if (sessions.length > 0) {
    notes.push(
      `Scheduled ${sessions.length} session${sessions.length === 1 ? '' : 's'} across the next ${config.horizonDays} days, most urgent work first.`,
    );
  }
  if (unscheduledMinutes > 0) {
    notes.push(
      `${Math.round(unscheduledMinutes / 60)}h of work did not fit. Add more availability, extend the horizon, or reduce topic workload.`,
    );
  }
  const missedDeadlines = items.filter(
    (i) => i.remainingMinutes > 0 && i.deadline && i.deadline < config.startDate,
  );
  if (missedDeadlines.length > 0) {
    notes.push(`${missedDeadlines.length} topic(s) have deadlines that already passed.`);
  }

  return { sessions, unscheduledMinutes, notes };
}
