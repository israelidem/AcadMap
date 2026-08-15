/**
 * Study streaks.
 *
 * A day qualifies only when the student completed at least one *scheduled*
 * study session on it. Opening the app never awards a streak.
 */

import type { DateStr, StreakState, StudySession } from './types.js';
import { addDays, daysBetween, todayStr } from './time.js';

export function qualifyingDays(sessions: StudySession[]): DateStr[] {
  const days = new Set<DateStr>();
  for (const session of sessions) {
    if (session.status === 'COMPLETED') days.add(session.date);
  }
  return [...days].sort();
}

export function computeStreak(sessions: StudySession[], today: DateStr = todayStr()): StreakState {
  const days = qualifyingDays(sessions);
  if (days.length === 0) return { current: 0, longest: 0, lastQualifyingDay: null };

  // Longest run of consecutive qualifying days.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (daysBetween(days[i - 1], days[i]) === 1) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }

  // Current streak: counts back from today, or from yesterday if today is not
  // yet done, so the streak isn't lost before the day is over.
  const set = new Set(days);
  let anchor: DateStr | null = null;
  if (set.has(today)) anchor = today;
  else if (set.has(addDays(today, -1))) anchor = addDays(today, -1);

  let current = 0;
  if (anchor) {
    let cursor = anchor;
    while (set.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }

  return { current, longest: Math.max(longest, current), lastQualifyingDay: days[days.length - 1] };
}

export interface SessionStats {
  planned: number;
  completed: number;
  skipped: number;
  completionRate: number;
  minutesCompleted: number;
}

export function sessionStats(sessions: StudySession[]): SessionStats {
  const planned = sessions.filter((s) => s.status !== 'RESCHEDULED').length;
  const completed = sessions.filter((s) => s.status === 'COMPLETED').length;
  const skipped = sessions.filter((s) => s.status === 'SKIPPED').length;
  const minutesCompleted = sessions
    .filter((s) => s.status === 'COMPLETED')
    .reduce((sum, s) => sum + s.durationMinutes, 0);

  return {
    planned,
    completed,
    skipped,
    completionRate: planned > 0 ? Math.round((completed / planned) * 100) : 0,
    minutesCompleted,
  };
}
