/**
 * Shared HTTP plumbing for the AcadMap API (Vercel Functions, Web-standard
 * Request/Response — no framework, no dependencies).
 *
 * Security posture:
 *   * Sessions live in an HttpOnly, Secure, SameSite=Lax cookie.
 *   * `requireUser` re-reads the session from the database on every request, so
 *     a suspended or deleted account loses access immediately.
 *   * `requireOwner` re-checks the owner role server-side — hiding the admin UI
 *     is never treated as authorisation.
 *   * `rateLimit` uses a Postgres counter, so no paid Redis is needed.
 *   * `requireSameOrigin` blocks cross-site writes; SameSite=Lax alone does not
 *     cover top-level form posts.
 *   * `idempotent` makes retried writes safe, and `jsonCached` lets unchanged
 *     reads answer with a 304 instead of a payload.
 */

import { z } from 'zod';
import { one, sql } from './db';

export const SESSION_COOKIE = 'am_session';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  role: 'STUDENT' | 'OWNER';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
}

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

const CORS_ORIGIN = process.env.APP_ORIGIN ?? '';

function baseHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  // Same-origin by default; only widen if APP_ORIGIN is explicitly configured.
  if (CORS_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = CORS_ORIGIN;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...baseHeaders(), ...(init.headers as Record<string, string> | undefined) },
  });
}

export function fail(status: number, message: string, extra: unknown = undefined): Response {
  return json({ error: message, ...(extra ? { details: extra } : {}) }, { status });
}

export const methodNotAllowed = (allowed: string[]): Response =>
  json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: allowed.join(', ') } });

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

/** Parses and validates a JSON body. Never trust the client. */
export async function readBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: fail(400, 'Invalid JSON body') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: fail(422, 'Validation failed', parsed.error.flatten()) };
  }
  return { ok: true, data: parsed.data };
}

/* -------------------------------------------------------------------------- */
/* Cookies & sessions                                                         */
/* -------------------------------------------------------------------------- */

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 86_400;
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  await sql(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [token, userId, String(SESSION_DAYS)],
  );
  return token;
}

export async function destroySession(request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await sql('DELETE FROM sessions WHERE token = $1', [token]);
}

/** Returns the signed-in, active user or null. */
export async function currentUser(request: Request): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await one<SessionUser>(
    `SELECT u.id, u.email, u.role, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  if (!row || row.status !== 'ACTIVE') return null;
  return row;
}

export async function requireUser(
  request: Request,
): Promise<{ ok: true; user: SessionUser } | { ok: false; response: Response }> {
  const user = await currentUser(request);
  if (!user) return { ok: false, response: fail(401, 'Authentication required') };
  return { ok: true, user };
}

export async function requireOwner(
  request: Request,
): Promise<{ ok: true; user: SessionUser } | { ok: false; response: Response }> {
  const result = await requireUser(request);
  if (!result.ok) return result;
  if (result.user.role !== 'OWNER') {
    return { ok: false, response: fail(403, 'Unauthorized') };
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Fixed-window rate limit backed by Postgres.
 *
 * @param key    Bucket identity, e.g. `login:<ip>`.
 * @param limit  Maximum hits per window.
 * @param window Window length in seconds.
 */
export async function rateLimit(key: string, limit: number, windowSeconds = 60): Promise<boolean> {
  const row = await one<{ hits: number }>(
    `INSERT INTO rate_limits (key, window_start, hits)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
     RETURNING hits`,
    [key, windowSeconds],
  );
  return (row?.hits ?? 1) <= limit;
}

/**
 * Applies a rate limit and returns the 429 to send back, or null to continue.
 * Preferred over calling `rateLimit` directly because it also sets Retry-After.
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowSeconds = 60,
): Promise<Response | null> {
  const allowed = await rateLimit(key, limit, windowSeconds);
  if (allowed) return null;
  return json(
    { error: 'Too many requests. Please slow down and try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(windowSeconds) } },
  );
}

/**
 * Per-user budget for state-changing requests, plus a per-IP ceiling so one
 * address cannot burn the free tier with many throwaway accounts.
 */
export async function limitWrites(
  request: Request,
  userId: string,
  endpoint: string,
): Promise<Response | null> {
  return (
    (await enforceRateLimit(`w:${endpoint}:${userId}`, 60, 60)) ??
    (await enforceRateLimit(`w:ip:${clientIp(request)}`, 240, 60))
  );
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

/* -------------------------------------------------------------------------- */
/* CSRF                                                                       */
/* -------------------------------------------------------------------------- */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Rejects cross-site state changes. The browser always sends Origin on
 * cross-origin requests and on same-origin POSTs, so an Origin that is present
 * and foreign is a genuine CSRF attempt. Requests with no Origin at all (curl,
 * server-to-server) are allowed through to authentication instead.
 */
export function requireSameOrigin(request: Request): Response | null {
  if (SAFE_METHODS.has(request.method)) return null;

  const origin = request.headers.get('origin');
  if (!origin) return null;

  const allowed = new Set<string>([new URL(request.url).origin]);
  if (CORS_ORIGIN) allowed.add(CORS_ORIGIN);

  return allowed.has(origin) ? null : fail(403, 'Cross-site request blocked');
}

/* -------------------------------------------------------------------------- */
/* Conditional responses                                                      */
/* -------------------------------------------------------------------------- */

/** FNV-1a over the serialised body: fast, allocation-light, good enough for an ETag. */
function weakEtag(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `W/"${(hash >>> 0).toString(36)}-${body.length.toString(36)}"`;
}

/**
 * JSON with an ETag, answering 304 when the client already has this exact body.
 * Read-heavy dashboard and performance polling then costs headers only.
 */
export function jsonCached(request: Request, data: unknown, maxAgeSeconds = 0): Response {
  const body = JSON.stringify(data);
  const etag = weakEtag(body);
  const headers: Record<string, string> = {
    ETag: etag,
    'Cache-Control': `private, max-age=${maxAgeSeconds}, must-revalidate`,
  };

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ...baseHeaders(), ...headers } });
  }
  return json(data, { headers });
}

/* -------------------------------------------------------------------------- */
/* Idempotency                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Replays the first response for a given Idempotency-Key instead of performing
 * the write twice. Without a key the request runs normally, so this is opt-in
 * per call site and costs nothing for reads.
 *
 * The reservation row is inserted *before* the work runs, so two simultaneous
 * retries cannot both slip past the lookup: the loser gets 409.
 */
export async function idempotent(
  request: Request,
  userId: string,
  endpoint: string,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  const key = request.headers.get('idempotency-key');

  if (!key || key.length < 8 || key.length > 128) {
    const result = await run();
    return json(result.body, { status: result.status });
  }

  const replay = await one<{ status: number; response: unknown }>(
    'SELECT status, response FROM idempotency_keys WHERE user_id = $1 AND endpoint = $2 AND key = $3',
    [userId, endpoint, key],
  );
  if (replay) {
    if (replay.status === 0) return fail(409, 'That request is already being processed.');
    return json(replay.response, {
      status: replay.status,
      headers: { 'Idempotent-Replay': 'true' },
    });
  }

  const reserved = await one<{ key: string }>(
    `INSERT INTO idempotency_keys (key, user_id, endpoint, status, response)
     VALUES ($1, $2, $3, 0, '{}'::jsonb)
     ON CONFLICT (user_id, endpoint, key) DO NOTHING
     RETURNING key`,
    [key, userId, endpoint],
  );
  if (!reserved) return fail(409, 'That request is already being processed.');

  try {
    const result = await run();
    await sql(
      `UPDATE idempotency_keys SET status = $4, response = $5::jsonb
        WHERE user_id = $1 AND endpoint = $2 AND key = $3`,
      [userId, endpoint, key, result.status, JSON.stringify(result.body)],
    );
    return json(result.body, { status: result.status });
  } catch (error) {
    // Never leave a reservation behind: the student must be able to retry.
    await sql(
      'DELETE FROM idempotency_keys WHERE user_id = $1 AND endpoint = $2 AND key = $3',
      [userId, endpoint, key],
    );
    throw error;
  }
}

/**
 * Deletes expired sessions, reset tokens, rate-limit windows and idempotency
 * records. Called opportunistically (roughly 1 request in 200) so the free tier
 * needs no scheduled job.
 */
export async function purgeExpiredSometimes(): Promise<void> {
  if (Math.random() > 0.005) return;
  try {
    await sql('SELECT acadmap_purge_expired()');
  } catch {
    // Housekeeping must never fail a user request.
  }
}

/** Records a usage event for product analytics (no academic data). */
export async function track(name: string, userId: string | null = null): Promise<void> {
  try {
    await sql('INSERT INTO usage_events (user_id, name) VALUES ($1, $2)', [userId, name]);
  } catch {
    // Analytics must never break a request.
  }
}

export async function logAdminAction(
  adminEmail: string,
  action: string,
  resource: string,
): Promise<void> {
  await sql('INSERT INTO admin_activity_logs (admin_email, action, resource) VALUES ($1, $2, $3)', [
    adminEmail,
    action,
    resource,
  ]);
}
