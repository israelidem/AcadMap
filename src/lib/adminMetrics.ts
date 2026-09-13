/**
 * Owner-console metrics, read from the server.
 *
 * The console used to count its figures out of this browser's own store. That is
 * fine for a student — their store *is* their record — but wrong for analytics
 * about every account: `usage_events` are written per device, so the owner saw
 * one set of numbers on a laptop, a different set on a phone, and zeros in a
 * fresh browser while the product was busy. Nothing here reads the local store.
 *
 * The response is polled while the console is open, and the previous figures
 * stay on screen while a new set is in flight, so the page never flashes empty
 * between refreshes.
 */

import { useCallback, useEffect, useState } from 'react';
import type { UsageEvent } from '@shared/types';
import { ApiError, api, type AdminOverview } from '@/lib/api';

const REFRESH_MS = 60_000;

export interface AdminMetricsState {
  data: AdminOverview | null;
  error: string | null;
  /** Only true before the first successful load; refreshes are not "loading". */
  loading: boolean;
  refreshing: boolean;
  fetchedAt: Date | null;
  refresh: () => void;
}

export function useAdminOverview(days: number): AdminMetricsState {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setRefreshing(true);
      try {
        const next = await api.adminOverview(days, controller.signal);
        if (cancelled) return;
        setData(next);
        setError(null);
        setFetchedAt(new Date());
      } catch (caught) {
        if (cancelled || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        // The figures already on screen are still the last true reading, so they
        // are left in place and the failure is reported beside them.
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Could not load metrics from the server.',
        );
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }

    void load();

    // Polling keeps a console left open on a wall display honest.
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [days, nonce]);

  return { data, error, loading: data === null && refreshing, refreshing, fetchedAt, refresh };
}

/* -------------------------------------------------------------------------- */
/*                             Shaping for the UI                             */
/* -------------------------------------------------------------------------- */

/** Local `YYYY-MM-DD` keys for the last `count` days, oldest first. */
function lastDays(count: number): string[] {
  const keys: string[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const day = new Date(cursor.getTime() - index * 86_400_000);
    keys.push(
      `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
    );
  }
  return keys;
}

/**
 * How the figure ledger reads a count.
 *
 * An interface rather than raw numbers because the ledger renders the same three
 * things for every row — this period, the one before, and the shape — and should
 * not know or care that they arrive over HTTP.
 */
export interface FigureSource {
  count: (event: UsageEvent['name']) => number;
  previous: (event: UsageEvent['name']) => number | null;
  series: (event: UsageEvent['name'], days: number) => number[];
}

export function figureSource(data: AdminOverview | null): FigureSource {
  const buckets = new Map<string, number>();
  for (const row of data?.daily ?? []) buckets.set(`${row.name}|${row.day}`, row.total);

  return {
    count: (event) => data?.events[event] ?? 0,
    // Null, not zero, until the server has answered: an unknown previous period
    // must not be printed as a −100% collapse.
    previous: (event) => (data ? (data.previous[event] ?? 0) : null),
    series: (event, days) => lastDays(days).map((day) => buckets.get(`${event}|${day}`) ?? 0),
  };
}

/** Daily totals for one event name over `days`, for the activity plot. */
export function plotValues(
  data: AdminOverview | null,
  event: UsageEvent['name'],
  days: number,
): number[] {
  return figureSource(data).series(event, days);
}
