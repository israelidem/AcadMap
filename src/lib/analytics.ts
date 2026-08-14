/**
 * Product analytics.
 *
 * Only non-sensitive counters are recorded (which features are used, not what
 * a student studied or scored). Events are capped so the store cannot grow
 * without bound.
 */

import type { ID, UsageEvent } from '@shared/types';
import { getDatabase, update } from './store';
import { nowIso, uid } from './utils';

const MAX_EVENTS = 2_000;

export function trackEvent(name: UsageEvent['name'], userId: ID | null = null): void {
  const event: UsageEvent = {
    id: uid('evt'),
    userId,
    name,
    createdAt: nowIso(),
  };
  update((current) => ({
    ...current,
    usageEvents: [...current.usageEvents, event].slice(-MAX_EVENTS),
  }));
}

export function countEvents(name: UsageEvent['name'], sinceIso?: string): number {
  return getDatabase().usageEvents.filter(
    (event) => event.name === name && (!sinceIso || event.createdAt >= sinceIso),
  ).length;
}

/**
 * Events in a window, used to compare one period against the one before it.
 *
 * A bare count says "31 results recorded" and leaves the only question that
 * matters unanswered: more or fewer than last month?
 */
export function countEventsBetween(
  name: UsageEvent['name'],
  sinceIso: string,
  untilIso: string,
): number {
  return getDatabase().usageEvents.filter(
    (event) => event.name === name && event.createdAt >= sinceIso && event.createdAt < untilIso,
  ).length;
}

/** Change between this period and the previous one of equal length, as a ratio. */
export function trend(name: UsageEvent['name'], days: number): number | null {
  const now = countEvents(name, daysAgoIso(days));
  const before = countEventsBetween(name, daysAgoIso(days * 2), daysAgoIso(days));
  // No history to compare against: an arrow would be invented, not measured.
  if (before === 0) return now === 0 ? null : 1;
  return (now - before) / before;
}

/**
 * One bucket per day, oldest first, for a set of event names.
 *
 * Buckets are by calendar day in the viewer's own timezone, which is what makes
 * a chart legible to the person reading it: "yesterday" should mean yesterday
 * where they are.
 */
export function dailyCounts(names: UsageEvent['name'][], days: number): number[] {
  const wanted = new Set<string>(names);
  const buckets = new Array<number>(days).fill(0);

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();

  for (const event of getDatabase().usageEvents) {
    if (!wanted.has(event.name)) continue;
    const at = new Date(event.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    at.setHours(0, 0, 0, 0);
    const index = days - 1 - Math.round((today - at.getTime()) / 86_400_000);
    if (index >= 0 && index < days) buckets[index] += 1;
  }

  return buckets;
}

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}


