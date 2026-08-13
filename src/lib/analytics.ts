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

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
