/**
 * POST /api/events — records product-analytics events for the signed-in account.
 *
 * Most events are already written server-side by the endpoint that performs the
 * action (see `track` in _lib/http.ts). The ones that are not have no server
 * side at all: opening the app, completing or skipping a study session, and
 * generating a plan all happen against the device's local store, which is what
 * makes the product work offline. Those were only ever counted in the browser
 * that produced them, so the owner console could not see them.
 *
 * Nothing academic is accepted here: a name from a closed list and a timestamp.
 * No grade, course, score or title can be sent through this route (ADM-005).
 */

import { usageEventsSchema } from '../shared/schemas.js';
import { sql } from './_lib/db.js';
import {
  json,
  limitWrites,
  methodNotAllowed,
  readBody,
  requireSameOrigin,
  requireUser,
} from './_lib/http.js';
import { toVercelHandler } from './_lib/vercel.js';

export default toVercelHandler(handler);

async function handler(request: Request): Promise<Response> {
  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  if (request.method !== 'POST') return methodNotAllowed(['POST']);

  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  // Batched flushes are few even when a device returns online with a backlog, so
  // the standard write budget is enough to stop a loop filling the table.
  const limited = await limitWrites(request, auth.user.id, 'events');

  if (limited) return limited;

  const body = await readBody(request, usageEventsSchema);
  if (!body.ok) return body.response;

  /*
   * One statement for the batch. `unnest` expands two arrays into rows, which
   * keeps a flush of fifty events to a single round trip — the alternative is
   * fifty inserts over a connection opened per request.
   *
   * A missing timestamp falls back to now(): older clients, and events recorded
   * before the device knew the time, still land on a real day.
   */
  const names = body.data.events.map((event) => event.name);
  const times = body.data.events.map((event) => event.at ?? null);

  await sql(
    `INSERT INTO usage_events (user_id, name, created_at)
     SELECT $1, batch.name, COALESCE(batch.at::timestamptz, now())
       FROM unnest($2::text[], $3::text[]) AS batch(name, at)`,
    [auth.user.id, names, times],
  );

  return json({ recorded: names.length }, { status: 201 });
}
