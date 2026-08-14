/**
 * POST /api/auth/request-reset — email a password reset link.
 *
 * Three things this endpoint is careful about:
 *
 *   * It does not reveal who has an account. Whether or not the address is
 *     registered, the answer is the same, because a different response would
 *     turn this into a membership oracle.
 *   * It stores only the hash of the token, the same way a password is stored.
 *     A leaked `password_resets` table then yields no usable links.
 *   * It does not claim success it has not achieved. If the deployment has no
 *     mail provider configured, or the provider rejects the message, that is
 *     reported as a server error — the previous behaviour, telling the student
 *     an email was on its way when nothing was sent, is the bug being fixed.
 */

import { requestResetSchema } from '../../shared/schemas';
import { one, sql } from '../_lib/db';
import {
  clientIp,
  fail,
  json,
  methodNotAllowed,
  purgeExpiredSometimes,
  rateLimit,
  readBody,
  requireSameOrigin,
} from '../_lib/http';
import { mailConfigured, passwordResetEmail, sendMail } from '../_lib/mail';
// Generic random-token helpers; the "share" naming is historical.
import { createShareToken, hashShareToken } from '../_lib/tokens';

export const config = { runtime: 'edge' };

/** Long enough to switch device and read email, short enough to limit exposure. */
const VALID_MINUTES = 60;

/**
 * Where the link should point.
 *
 * `APP_ORIGIN` wins when set — the same variable that declares where the app is
 * served from — because a link must survive being opened outside the request that
 * created it, and behind a proxy the request's own host can be wrong. Otherwise
 * the request origin is used, which is correct for the ordinary single-domain
 * deployment.
 */
function appOrigin(request: Request): string {
  const configured = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.APP_ORIGIN;

  if (configured && configured.trim()) return configured.trim().replace(/\/$/, '');
  return new URL(request.url).origin;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);

  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  /*
   * Checked before the account lookup so a misconfigured deployment answers the
   * same way for every address, and so the owner sees the real problem instead
   * of silence.
   */
  if (!mailConfigured()) {
    return fail(
      503,
      'Password reset email is not configured on this deployment yet. Contact AcadMap support.',
    );
  }

  if (!(await rateLimit(`reset:${clientIp(request)}`, 5, 3600))) {
    return fail(429, 'Too many reset requests. Please try again later.');
  }

  const body = await readBody(request, requestResetSchema);
  if (!body.ok) return body.response;

  const email = body.data.email.toLowerCase();

  // Also limited per address, so one inbox cannot be flooded from many IPs.
  if (!(await rateLimit(`reset:acct:${email}`, 3, 3600))) {
    return fail(429, 'Too many reset requests for this address. Please try again later.');
  }

  // The same answer either way. A student who mistypes their address is told to
  // check their inbox and finds nothing, which is the accepted cost of not
  // confirming to a stranger that an account exists.
  const sent = json({ ok: true });

  const user = await one<{ id: string; email: string; status: string }>(
    'SELECT id, email, status FROM users WHERE lower(email) = $1',
    [email],
  );
  if (!user || user.status !== 'ACTIVE') return sent;

  const token = createShareToken();
  const tokenHash = await hashShareToken(token);
  const expiresAt = new Date(Date.now() + VALID_MINUTES * 60_000).toISOString();

  /*
   * Any earlier request is invalidated. Two live links for one account is a
   * larger attack surface for no benefit, and the student is only ever looking
   * at the newest email.
   */
  await sql('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
  await sql(
    'INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [tokenHash, user.id, expiresAt],
  );

  // Lands on the recovery screen with the token filled in (src/pages/Recover.tsx).
  const link = `${appOrigin(request)}/recover?token=${token}`;

  const result = await sendMail({ to: user.email, ...passwordResetEmail(link, VALID_MINUTES) });

  if (!result.ok) {
    // The token is useless if its email never left, and leaving it behind would
    // block the next attempt by being the "latest" request.
    await sql('DELETE FROM password_resets WHERE token = $1', [tokenHash]);
    console.error('[request-reset] send failed:', result.error);
    return fail(502, 'We could not send the reset email just now. Please try again shortly.');
  }

  await purgeExpiredSometimes();
  return sent;
}
