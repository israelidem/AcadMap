/** POST /api/auth/login — verify credentials and start a session. */

import { loginSchema } from '../../shared/schemas';
import { one, sql } from '../_lib/db';
import {
  clientIp,
  createSession,
  destroySession,
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
import { verifyPassword } from '../_lib/password';

export const config = { runtime: 'edge' };

interface Row {
  id: string;
  email: string;
  role: 'STUDENT' | 'OWNER';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  password_hash: string;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);

  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  if (!(await rateLimit(`login:${clientIp(request)}`, 10, 300))) {
    return fail(429, 'Too many attempts. Please try again later.');
  }

  const body = await readBody(request, loginSchema);
  if (!body.ok) return body.response;

  const email = body.data.email.toLowerCase();

  // A second bucket keyed by account, so a botnet spread across many IPs still
  // cannot grind away at one student's password.
  if (!(await rateLimit(`login:acct:${email}`, 10, 300))) {
    return fail(429, 'Too many attempts for this account. Please try again later.');
  }

  const row = await one<Row>(
    'SELECT id, email, role, status, password_hash FROM users WHERE lower(email) = $1',
    [email],
  );

  // Same generic message whether the email or the password was wrong.
  const invalid = fail(401, 'Incorrect email or password.');
  if (!row) return invalid;
  if (!(await verifyPassword(body.data.password, row.password_hash))) return invalid;
  if (row.status !== 'ACTIVE') return fail(403, 'This account is not active.');

  await sql('UPDATE users SET last_seen_at = now() WHERE id = $1', [row.id]);
  await track('app_opened', row.id);
  await purgeExpiredSometimes();

  // Rotate: drop whatever session the cookie already carried before issuing a
  // new one, so a fixated token cannot survive a successful login.
  await destroySession(request);
  const token = await createSession(row.id);
  return json(
    { user: { id: row.id, email: row.email, role: row.role, status: row.status } },
    { headers: { 'Set-Cookie': sessionCookie(token) } },
  );
}
