/**
 * GET    /api/auth/session — who am I? (also returns feature flags)
 * DELETE /api/auth/session — log out.
 */

import {
  clearedSessionCookie,
  currentUser,
  destroySession,
  json,
  methodNotAllowed,
} from '../_lib/http';
import { sql } from '../_lib/db';

export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'DELETE') {
    await destroySession(request);
    return json({ ok: true }, { headers: { 'Set-Cookie': clearedSessionCookie } });
  }

  if (request.method !== 'GET') return methodNotAllowed(['GET', 'DELETE']);

  const user = await currentUser(request);
  const { rows } = await sql<{ key: string; enabled: boolean }>(
    'SELECT key, enabled FROM feature_flags',
  );
  const featureFlags = Object.fromEntries(rows.map((row) => [row.key, row.enabled]));

  return json({ user, featureFlags });
}
