/** POST /api/auth/register — create an account and start a session. */

import { registerSchema } from '@shared/schemas';
import { one, sql } from '../_lib/db';
import {
  clientIp,
  createSession,
  fail,
  json,
  methodNotAllowed,
  rateLimit,
  readBody,
  requireSameOrigin,
  sessionCookie,
  track,
} from '../_lib/http';
import { hashPassword } from '../_lib/password';

const OWNER_EMAIL = (process.env.OWNER_EMAIL ?? '').trim().toLowerCase();

export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);

  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  if (!(await rateLimit(`register:${clientIp(request)}`, 5, 600))) {
    return fail(429, 'Too many attempts. Please try again later.');
  }

  const body = await readBody(request, registerSchema);
  if (!body.ok) return body.response;

  const email = body.data.email.toLowerCase();
  const existing = await one<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1', [
    email,
  ]);
  if (existing) return fail(409, 'An account with that email already exists.');

  const role = OWNER_EMAIL && email === OWNER_EMAIL ? 'OWNER' : 'STUDENT';

  // ON CONFLICT closes the race between the check above and the insert: two
  // simultaneous sign-ups with the same email cannot both succeed.
  const user = await one<{ id: string }>(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [email, await hashPassword(body.data.password), role],
  );
  if (!user) return fail(409, 'An account with that email already exists.');

  await sql(
    `INSERT INTO profiles (user_id, full_name) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id, body.data.fullName],
  );
  await sql('INSERT INTO preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [
    user.id,
  ]);
  await track('registered', user.id);

  const token = await createSession(user.id);
  return json(
    { user: { id: user.id, email, role, status: 'ACTIVE' } },
    { status: 201, headers: { 'Set-Cookie': sessionCookie(token) } },
  );
}
