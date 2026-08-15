/**
 * GET /api/admin/overview?days=30 — owner-only product metrics.
 *
 * Authorisation is checked server-side on every call (ADM-001). Aggregates only:
 * no individual academic records are returned (ADM-005).
 */

import { one, sql } from '../_lib/db.js';
import { fail, jsonCached, methodNotAllowed, requireOwner } from '../_lib/http.js';
import { toVercelHandler } from '../_lib/vercel.js';

const ALLOWED_RANGES = new Set([1, 7, 30, 90]);

export default toVercelHandler(handler);

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);

  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  const days = Number(new URL(request.url).searchParams.get('days') ?? 30);
  if (!ALLOWED_RANGES.has(days)) return fail(400, 'days must be one of 1, 7, 30, 90');

  const totals = await one<{
    students: number;
    newStudents: number;
    activeUsers: number;
    onboarded: number;
  }>(
    `SELECT
      /* "user" is Better Auth's table: reserved word, camelCase columns. */
      (SELECT count(*) FROM "user" WHERE "role" <> 'OWNER' AND "status" <> 'DELETED')::int AS students,

      (SELECT count(*) FROM "user"
         WHERE "role" <> 'OWNER' AND "createdAt" > now() - ($1 || ' days')::interval)::int AS "newStudents",
      (SELECT count(*) FROM "user"
         WHERE "lastSeenAt" > now() - ($1 || ' days')::interval)::int AS "activeUsers",

       (SELECT count(*) FROM profiles WHERE onboarding_completed_at IS NOT NULL)::int AS onboarded`,
    [String(days)],
  );

  const { rows: events } = await sql<{ name: string; total: number }>(
    `SELECT name, count(*)::int AS total
       FROM usage_events
      WHERE created_at > now() - ($1 || ' days')::interval
      GROUP BY name`,
    [String(days)],
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
  return jsonCached(request, {
    range: { days },
    totals,
    events: Object.fromEntries(events.map((row) => [row.name, row.total])),
    institutions,
    feedback,
  }, 30);
}
