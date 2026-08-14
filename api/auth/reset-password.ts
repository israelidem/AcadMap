/**
 * POST /api/auth/reset-password — set a new password from an emailed link.
 *
 * The link is a bearer credential, so it is treated like one: single use, short
 * lived, and matched by hash rather than by the value stored in the row.
 *
 * A completed reset also ends every existing session for the account. Someone
 * resetting a password may be doing it precisely because another device is not
 * theirs any more, and leaving those sessions alive would defeat the point. The
 * device doing the reset is signed straight in, so the student is not asked for
 * the password they have just chosen.
 */

import { resetPasswordSchema } from '../../shared/schemas';
import { one, sql } from '../_lib/db';
import {
  clientIp,
  createSession,
  fail,
  json,
  methodNotAllowed,
  purgeExpiredSometimes,
  rateLimit,
  readBody,
  requireSameOrigin,
  sessionCookie,
  track,
} from '../_lib/http';
import { hashPassword } from '../_lib/password';
import { hashShareToken } from '../_lib/tokens';

export const config = { runtime: 'edge' };

interface Row {
  user_id: string;
  email: string;
  role: 'STUDENT' | 'OWNER';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);

  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  // Guessing a 128-bit token is hopeless, but the limit costs nothing and caps
  // the damage from a leaked link being sprayed at the endpoint.
  if (!(await rateLimit(`reset-confirm:${clientIp(request)}`, 10, 900))) {
    return fail(429, 'Too many attempts. Please try again later.');
  }

  const body = await readBody(request, resetPasswordSchema);
  if (!body.ok) return body.response;

  const tokenHash = await hashShareToken(body.data.token.trim());

  const row = await one<Row>(
    `SELECT r.user_id, u.email, u.role, u.status
       FROM password_resets r
       JOIN users u ON u.id = r.user_id
      WHERE r.token = $1
        AND r.used_at IS NULL
        AND r.expires_at > now()`,
    [tokenHash],
  );

  // Expired, already used and never issued are one message: none of them tells
  // the holder anything actionable, and distinguishing them leaks information.
  if (!row) {
    return fail(400, 'This reset link is no longer valid. Request a new one.');
  }
  if (row.status !== 'ACTIVE') return fail(403, 'This account is not active.');

  const passwordHash = await hashPassword(body.data.password);

  await sql('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, row.user_id]);
  await sql('UPDATE password_resets SET used_at = now() WHERE token = $1', [tokenHash]);
  await sql('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);

  await track('password_reset', row.user_id);
  await purgeExpiredSometimes();

  const token = await createSession(row.user_id);
  return json(
    { user: { id: row.user_id, email: row.email, role: row.role, status: row.status } },
    { headers: { 'Set-Cookie': sessionCookie(token) } },
  );
}
