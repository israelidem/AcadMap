/**
 * GET /api/share/:token — public, read-only academic snapshot.
 *
 * Only the fields the student explicitly selected are stored in `payload`, so
 * this endpoint cannot leak an academic record even if the token is guessed.
 * Expired and revoked tokens are indistinguishable from unknown ones.
 *
 * The table stores the SHA-256 of the token, so the lookup hashes the incoming
 * value first — a leaked database yields no usable links.
 */

import { one, sql } from '../_lib/db';
import { clientIp, fail, json, methodNotAllowed, rateLimit } from '../_lib/http';
import { hashShareToken } from '../_lib/tokens';

export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);

  if (!(await rateLimit(`share:${clientIp(request)}`, 60, 60))) {
    return fail(429, 'Too many requests.');
  }

  const token = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!/^[0-9a-f]{20,128}$/.test(token)) return fail(404, 'Snapshot not found');

  const snapshot = await one<{ id: string; payload: unknown; createdAt: string }>(
    `SELECT id, payload, created_at AS "createdAt"
       FROM share_snapshots
      WHERE token = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())`,
    [await hashShareToken(token)],
  );
  if (!snapshot) return fail(404, 'This snapshot is no longer available.');

  await sql('UPDATE share_snapshots SET views = views + 1 WHERE id = $1', [snapshot.id]);

  return json(
    { snapshot: { payload: snapshot.payload, createdAt: snapshot.createdAt } },
    // Short public cache: cheap on the free tier, still fresh enough.
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}
