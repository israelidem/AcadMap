/**
 * GET /api/admin/overview?days=30&offset=-60 — owner-only product metrics.
 *
 * Authorisation is checked server-side on every call (ADM-001). Aggregates only:
 * no individual academic records are returned (ADM-005).
 *
 * Everything the console draws is computed here, in the database, because the
 * console previously counted from the browser's own store: `usageEvents` are
 * device-local, so the owner saw one set of figures on a laptop and a different
 * set on a phone, and a fresh browser showed an empty product. Analytics about
 * every account cannot be derived from one device's copy of the data.
 *
 * `offset` is the viewer's timezone offset in minutes, as returned by
 * `Date.prototype.getTimezoneOffset`. Day buckets are cut in the owner's own
 * timezone so that "today" on the chart means today where they are reading it,
 * which is how the client used to bucket and what makes the plot legible.
 */

import { one, sql } from '../_lib/db.js';
import { fail, jsonCached, methodNotAllowed, requireOwner } from '../_lib/http.js';
import { toVercelHandler } from '../_lib/vercel.js';

const ALLOWED_RANGES = new Set([1, 7, 30, 90]);

/** The window the sparklines and the activity plot are drawn over. */
const SERIES_DAYS = 90;

export default toVercelHandler(handler);

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);

  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const days = Number(url.searchParams.get('days') ?? 30);
  if (!ALLOWED_RANGES.has(days)) return fail(400, 'days must be one of 1, 7, 30, 90');

  // Clamped to real timezones so the value can only shift a bucket boundary.
  const offsetRaw = Number(url.searchParams.get('offset') ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(-840, Math.min(840, offsetRaw)) : 0;
  // getTimezoneOffset is minutes *behind* UTC, so the sign is inverted here.
  const shift = `${-offset} minutes`;

  const totals = await one<{
    students: number;
    newStudents: number;
    activeUsers: number;
    onboarded: number;
    studying: number;
    suspended: number;
    deleted: number;
    openGoals: number;
  }>(
    `SELECT
      /* "user" is Better Auth's table: reserved word, camelCase columns. */
      (SELECT count(*) FROM "user" WHERE "role" <> 'OWNER' AND "status" <> 'DELETED')::int AS students,

      (SELECT count(*) FROM "user"
         WHERE "role" <> 'OWNER' AND "createdAt" > now() - ($1 || ' days')::interval)::int AS "newStudents",
      (SELECT count(*) FROM "user"
         WHERE "lastSeenAt" > now() - ($1 || ' days')::interval)::int AS "activeUsers",

       (SELECT count(*) FROM profiles WHERE onboarding_completed_at IS NOT NULL)::int AS onboarded,

       /*
        * Studying, not merely signed in: a completed session in the last two
        * days. This is the third step of the funnel and the only one of the
        * three that means the product is doing its job.
        */
       (SELECT count(DISTINCT user_id) FROM study_sessions
          WHERE status = 'COMPLETED' AND date > current_date - 2)::int AS studying,

       (SELECT count(*) FROM "user" WHERE "status" = 'SUSPENDED')::int AS suspended,
       (SELECT count(*) FROM "user" WHERE "status" = 'DELETED')::int AS deleted,
       (SELECT count(*) FROM goals WHERE achieved_at IS NULL)::int AS "openGoals"`,
    [String(days)],
  );

  /*
   * This period and the one before it, in one pass.
   *
   * The ledger prints a change column, and a change needs both halves measured
   * the same way — so the previous window is counted here rather than inferred.
   */
  const { rows: events } = await sql<{ name: string; total: number; previous: number }>(
    `SELECT name,
            count(*) FILTER (WHERE created_at > now() - ($1 || ' days')::interval)::int AS total,
            count(*) FILTER (WHERE created_at > now() - ($2 || ' days')::interval
                               AND created_at <= now() - ($1 || ' days')::interval)::int AS previous
       FROM usage_events
      WHERE created_at > now() - ($2 || ' days')::interval
      GROUP BY name`,
    [String(days), String(days * 2)],
  );

  /*
   * One row per event name per day, for the sparklines and the activity plot.
   * Bucketing in SQL keeps the response small — at most a few hundred rows —
   * where sending raw events would grow without bound.
   */
  const { rows: daily } = await sql<{ name: string; day: string; total: number }>(
    `SELECT name,
            to_char((created_at - $2::interval)::date, 'YYYY-MM-DD') AS day,
            count(*)::int AS total
       FROM usage_events
      WHERE created_at > now() - ($1 || ' days')::interval
      GROUP BY name, day
      ORDER BY day`,
    [String(SERIES_DAYS), shift],
  );

  const { rows: institutions } = await sql<{ institution: string; students: number }>(
    `SELECT institution, count(*)::int AS students
       FROM profiles
      WHERE institution <> ''
      GROUP BY institution
      ORDER BY students DESC
      LIMIT 25`,
  );

  const feedback = await one<{ open: number; total: number }>(
    `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open,
            count(*)::int AS total
       FROM feedback`,
  );

  // The overview is polled while the owner watches it; 30s of private caching
  // plus an ETag keeps that off the database.
  return jsonCached(
    request,
    {
      range: { days, seriesDays: SERIES_DAYS },
      totals,
      events: Object.fromEntries(events.map((row) => [row.name, row.total])),
      previous: Object.fromEntries(events.map((row) => [row.name, row.previous])),
      daily,
      institutions,
      feedback,
    },
    30,
  );
}
