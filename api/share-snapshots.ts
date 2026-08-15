/**
 * GET    /api/share-snapshots        — the student's own snapshots.
 * POST   /api/share-snapshots        — mint a snapshot link.
 * DELETE /api/share-snapshots?id=…   — revoke one.
 *
 * The snapshot payload is assembled here from the caller's own rows: the client
 * chooses *which* fields to include, never their values. A student therefore
 * cannot publish a CGPA they did not earn, and an unselected field never leaves
 * the database.
 *
 * Only the SHA-256 of the token is stored (see `_lib/tokens.ts`), so the plain
 * link is shown exactly once — at creation.
 */

import { shareSnapshotSchema } from '../shared/schemas';
import { computeGpa } from '../shared/gpa';
import { one, sql } from './_lib/db';
import {
  fail,
  idempotent,
  json,
  limitWrites,
  methodNotAllowed,
  readBody,
  requireSameOrigin,
  requireUser,
  track,
} from './_lib/http';
import { createShareToken, hashShareToken } from './_lib/tokens';
import { toVercelHandler } from './_lib/vercel';

/** Fields the student may choose to publish, mapped to profile columns. */
const PROFILE_FIELDS: Record<string, string> = {
  fullName: 'full_name',
  institution: 'institution',
  programme: 'programme',
  level: 'level',
};

export default toVercelHandler(handler);

async function handler(request: Request): Promise<Response> {
  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  const url = new URL(request.url);

  if (request.method === 'GET') {
    // Deliberately no token/hash column here: a listing must not hand back
    // working links, only the metadata needed to manage them.
    const { rows } = await sql(
      `SELECT id, fields, expires_at AS "expiresAt", revoked_at AS "revokedAt",
              views, created_at AS "createdAt"
         FROM share_snapshots
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [userId],
    );
    return json({ snapshots: rows });
  }

  if (request.method === 'POST') {
    const limited = await limitWrites(request, userId, 'share-snapshots');
    if (limited) return limited;

    const body = await readBody(request, shareSnapshotSchema);
    if (!body.ok) return body.response;
    const { fields, expiresInDays } = body.data;

    const profile = await one<Record<string, string | null>>(
      `SELECT full_name, institution, programme, level FROM profiles WHERE user_id = $1`,
      [userId],
    );
    if (!profile) return fail(404, 'Complete your profile before sharing.');

    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const column = PROFILE_FIELDS[field];
      if (column) {
        payload[field] = profile[column] ?? '';
        continue;
      }
      if (field === 'cgpa') {
        const { rows } = await sql<{ units: number; gradePoint: number; countsInGpa: boolean }>(
          `SELECT units::float8 AS units, grade_point::float8 AS "gradePoint",
                  counts_in_gpa AS "countsInGpa"
             FROM results WHERE user_id = $1`,
          [userId],
        );
        // Same rule as the dashboard, so a shared CGPA matches what the student
        // sees: results marked as not counting are left out.
        const { gpa, totalUnits } = computeGpa(rows);
        payload.cgpa = gpa;
        payload.completedUnits = totalUnits;
      }
    }

    const token = createShareToken();
    const tokenHash = await hashShareToken(token);

    return idempotent(request, userId, 'share-snapshots', async () => {
      const snapshot = await one<{ id: string; createdAt: string }>(
        `INSERT INTO share_snapshots (user_id, token, fields, payload, expires_at)
         VALUES ($1, $2, $3, $4::jsonb,
                 CASE WHEN $5::int IS NULL THEN NULL
                      ELSE now() + ($5 || ' days')::interval END)
         RETURNING id, created_at AS "createdAt"`,
        [userId, tokenHash, fields, JSON.stringify(payload), expiresInDays],
      );
      await track('snapshot_created', userId);

      // The plain token is returned once and never stored in this form.
      return {
        status: 201,
        body: { snapshot: { ...snapshot, fields, url: `/share/${token}` } },
      };
    });
  }

  if (request.method === 'DELETE') {
    const limited = await limitWrites(request, userId, 'share-snapshots');
    if (limited) return limited;

    const id = url.searchParams.get('id') ?? '';
    const result = await sql(
      `UPDATE share_snapshots SET revoked_at = now()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [id, userId],
    );
    return result.rowCount > 0 ? json({ ok: true }) : fail(404, 'Snapshot not found');
  }

  return methodNotAllowed(['GET', 'POST', 'DELETE']);
}
