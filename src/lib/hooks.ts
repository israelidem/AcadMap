/** Read-side hooks: session, ownership-scoped collections and derived metrics. */

import { useMemo } from 'react';
import type { GradingSystem, ID, Preferences, Profile, User } from '@shared/types';
import { cgpa, performanceHistory, termGpa, gpaTrend, type TermPerformance } from '@shared/gpa';
import { maxPoint } from '@shared/grading';
import { computeStreak, sessionStats } from '@shared/streak';
import { todayStr } from '@shared/time';
import { DEFAULT_PREFERENCES, useDb, type Database } from './store';
import { sortBy } from './utils';

export interface Session {
  user: User | null;
  profile: Profile | null;
  preferences: Preferences;
  isOwner: boolean;
  onboarded: boolean;
}

export function useSession(): Session {
  return useDb((db) => {
    const user = db.users.find((u) => u.id === db.sessionUserId) ?? null;
    const profile = user ? (db.profiles.find((p) => p.userId === user.id) ?? null) : null;
    return {
      user,
      profile,
      preferences: (user && db.preferences[user.id]) || DEFAULT_PREFERENCES,
      isOwner: user?.role === 'OWNER',
      onboarded: Boolean(profile?.onboardingCompletedAt),
    };
  });
}

export function useFeatureFlags() {
  return useDb((db) => db.featureFlags);
}

function mine<T extends { userId: ID }>(rows: T[], userId: ID | null): T[] {
  return userId ? rows.filter((row) => row.userId === userId) : [];
}

export function useUserData(userId: ID | null) {
  return useDb((db: Database) => ({
    years: sortBy(mine(db.academicYears, userId), (y) => y.startYear),
    terms: sortBy(mine(db.terms, userId), (t) => `${t.academicYearId}-${t.position}`),
    courses: mine(db.courses, userId),
    topics: sortBy(mine(db.topics, userId), (t) => t.position),
    results: mine(db.results, userId),
    events: sortBy(mine(db.events, userId), (e) => `${e.date}${e.startTime ?? ''}`),
    tasks: mine(db.tasks, userId),
    availability: sortBy(mine(db.availability, userId), (a) => `${a.weekday}${a.startTime}`),
    sessions: sortBy(mine(db.sessions, userId), (s) => `${s.date}${s.startTime}`),
    goals: mine(db.goals, userId),
    snapshots: mine(db.snapshots, userId),
    notifications: mine(db.notifications, userId),
    gradingSystems: db.gradingSystems.filter((s) => s.isPreset || s.userId === userId),
    announcements: db.announcements.filter((a) => a.status === 'PUBLISHED'),
  }));
}

export function useGradingSystem(): GradingSystem {
  const { user, profile } = useSession();
  const systems = useDb((db) => db.gradingSystems.filter((s) => s.isPreset || s.userId === user?.id));
  return (
    systems.find((s) => s.id === profile?.gradingSystemId) ??
    systems.find((s) => s.id === 'preset-5') ??
    systems[0]
  );
}

export interface AcademicMetrics {
  cgpa: number;
  completedUnits: number;
  qualityPoints: number;
  termGpa: number;
  termUnits: number;
  history: TermPerformance[];
  trend: 'UP' | 'DOWN' | 'FLAT' | 'NONE';
  bestTerm: TermPerformance | null;
  scale: number;
}

/** Everything the dashboard, performance page and snapshots need. */
export function useAcademicMetrics(): AcademicMetrics {
  const { user } = useSession();
  const system = useGradingSystem();
  const { results, terms } = useUserData(user?.id ?? null);
  const currentTermId = terms.find((t) => t.isCurrent)?.id ?? terms[terms.length - 1]?.id ?? null;

  return useMemo(() => {
    const overall = cgpa(results);
    const current = currentTermId
      ? termGpa(results, currentTermId)
      : { gpa: 0, totalUnits: 0, qualityPoints: 0, countedCourses: 0 };
    const history = performanceHistory(results, terms);
    const bestTerm =
      history.length > 0
        ? history.reduce((best, entry) => (entry.gpa > best.gpa ? entry : best), history[0])
        : null;

    return {
      cgpa: overall.gpa,
      completedUnits: overall.totalUnits,
      qualityPoints: overall.qualityPoints,
      termGpa: current.gpa,
      termUnits: current.totalUnits,
      history,
      trend: gpaTrend(history),
      bestTerm,
      scale: maxPoint(system),
    };
  }, [results, terms, currentTermId, system]);
}

export function usePlannerMetrics() {
  const { user } = useSession();
  const { sessions } = useUserData(user?.id ?? null);
  const today = todayStr();

  return useMemo(() => {
    const todays = sessions.filter((s) => s.date === today && s.status !== 'RESCHEDULED');
    const upcoming = sessions.filter((s) => s.date > today && s.status === 'SCHEDULED');
    return {
      today: todays,
      upcoming,
      streak: computeStreak(sessions, today),
      stats: sessionStats(sessions),
    };
  }, [sessions, today]);
}
