/**
 * POST /api/sync — one exchange of a student's academic data between a device
 * and the server. This is what makes a phone and a laptop the same account.
 *
 * A request carries what the device changed since it last synced, and asks for
 * everything the account changed since the same moment:
 *
 *   { since: "2026-08-01T09:00:00.000Z" | null, rows: [ … ] }
 *   → { rows: [ … ], syncedAt, hasMore }
 *
 * Design notes:
 *
 *   * The winner of a per-row collision is decided by `updated_at`, the same
 *     rule the client applies in shared/sync.ts. Ties go to the pushing device,
 *     matching `mine.updatedAt >= theirs.updatedAt` there, so both sides reach
 *     the same answer instead of each keeping its own copy.
 *   * A push that loses is not silently dropped: the server's version of that
 *     row is returned, so a device with a skewed clock is corrected rather than
 *     left believing its write stuck.
 *   * Deletes travel as rows with `deletedAt` set. A device that was offline for
 *     a week needs to be told the row is gone; an absence in the payload cannot
 *     say that.
 *   * `user_id` always comes from the session. The payload's contents are
 *     replicated, never trusted for ownership.
 *
 * Everything runs as three statements at most, whatever the batch size, because
 * the Neon HTTP endpoint charges a round trip per statement.
 */

import { syncRequestSchema } from '../shared/schemas.js';
import { sql } from './_lib/db.js';
import {
  fail,
  json,
  limitWrites,
  methodNotAllowed,
  purgeExpiredSometimes,
  readBody,
  requireSameOrigin,
  requireUser,
  touchLastSeen,
  track,

} from './_lib/http.js';
import { toVercelHandler } from './_lib/vercel.js';

/**
 * Rows returned per pull. A page beyond this is unusual — it means a device has
 * been away a long time — and is handled by `hasMore` rather than a bigger
 * response that risks the platform's execution limit.
 */
const PAGE_SIZE = 2000;

/** Guards against a payload that is within the row cap but still enormous. */
const MAX_PAYLOAD_BYTES = 1_000_000;

interface StoredRow {
  collection: string;
  id: string;
  data: Record<string, unknown>;
  updatedAt: string;
  deletedAt: string | null;
}

const UPSERT = `
  INSERT INTO sync_rows (user_id, collection, row_id, data, updated_at, deleted_at)
  SELECT $1, x.collection, x.row_id, x.data, x.updated_at, x.deleted_at
    FROM jsonb_to_recordset($2::jsonb)
      AS x(collection text, row_id uuid, data jsonb,
           updated_at timestamptz, deleted_at timestamptz)
  ON CONFLICT (user_id, collection, row_id) DO UPDATE
    SET data       = EXCLUDED.data,
        updated_at = EXCLUDED.updated_at,
        deleted_at = EXCLUDED.deleted_at
  WHERE EXCLUDED.updated_at >= sync_rows.updated_at`;

/**
 * Timestamps go out as strict ISO-8601 with a `Z`, formatted in SQL rather than
 * left to the driver.
 *
 * This is not cosmetic. Postgres renders a timestamptz as `2026-08-14 17:12:00+00`
 * — a space, an offset, no `Z` — and that is what the HTTP endpoint handed back.
 * The client stored those strings on the rows it pulled, and the moment one of
 * them was pushed again the request failed validation, which asks for ISO. One
 * pulled row was enough to make every later sync on that device fail with
 * "Validation failed", so a laptop could pull an account and then never upload
 * anything again.
 */
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const isoOf = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', ${ISO})`;

const PULL = `
  SELECT collection,
         row_id AS "id",
         data,
         ${isoOf('updated_at')} AS "updatedAt",
         ${isoOf('deleted_at')} AS "deletedAt"
    FROM sync_rows
   WHERE user_id = $1
     AND ($2::timestamptz IS NULL OR updated_at > $2::timestamptz)
   ORDER BY updated_at, row_id
   LIMIT ${PAGE_SIZE + 1}`;

/**
 * The server's copy of any pushed row it did not accept. Compared on
 * `updated_at` rather than re-deciding the winner, so a row the push did take
 * is not sent straight back.
 */
const REJECTED = `
  SELECT s.collection,
         s.row_id AS "id",
         s.data,
         ${isoOf('s.updated_at')} AS "updatedAt",
         ${isoOf('s.deleted_at')} AS "deletedAt"

    FROM sync_rows s
    JOIN jsonb_to_recordset($2::jsonb)
      AS x(collection text, row_id uuid, updated_at timestamptz)
      ON x.collection = s.collection AND x.row_id = s.row_id
   WHERE s.user_id = $1
     AND s.updated_at <> x.updated_at`;

export default toVercelHandler(handler);

async function handler(request: Request): Promise<Response> {
  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  if (request.method !== 'POST') return methodNotAllowed(['POST']);

  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const limited = await limitWrites(request, auth.user.id, 'sync');
  if (limited) return limited;

  const body = await readBody(request, syncRequestSchema);
  if (!body.ok) return body.response;
  const { since, rows } = body.data;

  const payload = JSON.stringify(
    rows.map((row) => ({
      collection: row.collection,
      row_id: row.id,
      data: row.data,
      updated_at: row.updatedAt,
      deleted_at: row.deletedAt,
    })),
  );

  if (payload.length > MAX_PAYLOAD_BYTES) {
    return fail(413, 'That is too much data for one sync. It will be sent in smaller batches.');
  }

  if (rows.length > 0) {
    await sql(UPSERT, [auth.user.id, payload]);
  }

  const pulled = (await sql<StoredRow>(PULL, [auth.user.id, since])).rows;
  const hasMore = pulled.length > PAGE_SIZE;
  const page = hasMore ? pulled.slice(0, PAGE_SIZE) : pulled;

  const corrections =
    rows.length > 0 ? (await sql<StoredRow>(REJECTED, [auth.user.id, payload])).rows : [];


  /*
   * A correction and a pulled row can be the same row. Sending it twice would be
   * harmless — applying is idempotent — but the client's merge reports conflicts,
   * and a duplicate would surface as one.
   */
  const merged = new Map<string, StoredRow>();
  for (const row of [...page, ...corrections]) {
    merged.set(`${row.collection}:${row.id}`, row);
  }

  /*
   * The watermark the device stores. On a truncated page it is the last row's
   * timestamp rolled back a millisecond: rows sharing that instant may sit on
   * either side of the cut, and re-sending a handful is safe where skipping one
   * would lose it permanently.
   */
  const last = page.at(-1);
  const syncedAt = hasMore && last
    ? new Date(new Date(last.updatedAt).getTime() - 1).toISOString()
    : new Date().toISOString();

  await track('sync', auth.user.id);
  // Syncing is the honest signal that the account is in use, which is what the
  // admin overview's active-user count reads. Throttled to once an hour inside.
  await touchLastSeen(auth.user.id);
  await purgeExpiredSometimes();


  return json({
    rows: [...merged.values()],
    syncedAt,
    hasMore,
  });
}
