/**
 * Authentication.
 *
 * The account lives on the server; the device keeps a mirror of it. That order
 * matters: an account that existed only in this browser's localStorage could not
 * be signed into anywhere else, which is exactly the bug where correct details
 * were rejected on a second device.
 *
 * So sign-in and registration go to the API first. On success the device stores
 * its own copy of the credential — salt plus a PBKDF2-SHA256 derived key, never
 * the password — which is what allows sign-in again later with no connection.
 * If the server cannot be reached at all, the local copy is used; if the server
 * is reachable and says no, that answer stands, because only it knows the
 * current password.
 */

import type { ID, User } from '@shared/types';
import { DEFAULT_PREFERENCES, enqueueAllRows, getDatabase, update } from './store';
import { nowIso, uid } from './utils';
import { trackEvent } from './analytics';
import { ApiError, api, type SessionUser } from './api';
import { forgetSyncState, syncNow } from './sync';
import { rekeyIds } from './rekey';



const PBKDF2_ITERATIONS = 100_000;

/**
 * The single designated owner account.
 *
 * `VITE_OWNER_EMAIL` overrides it for other deployments; the default is the
 * AcadMap owner so a fresh deploy needs no environment variable to get an admin.
 */
export const OWNER_EMAIL = (import.meta.env.VITE_OWNER_EMAIL ?? 'israelidem20@gmail.com')
  .toString()
  .trim()
  .toLowerCase();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes = 16): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return [...array].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return toHex(bits);
}

/** Constant-time-ish comparison to avoid trivial timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  userId?: ID;
}

/**
 * Brings the device's mirror in line with an account the server just confirmed.
 *
 * The server's user id is adopted verbatim, because every synced row is keyed by
 * it: a locally invented id would make the same student look like two accounts.
 * The credential is (re)derived from the password that just succeeded, so this
 * device can also authenticate offline, and a password changed elsewhere is
 * corrected here on the next successful sign-in.
 *
 * The profile and preference rows are created only if missing — a device that
 * already knows this account must not have its profile blanked by a sign-in.
 */
async function mirrorAccount(
  serverUser: SessionUser,
  password: string,
  fullName = '',
): Promise<void> {
  const salt = randomHex();
  const hash = await hashPassword(password, salt);
  const timestamp = nowIso();
  const userId = serverUser.id;

  update((current) => {
    const existing = current.users.find((u) => u.id === userId);

    const user: User = {
      ...(existing ?? {
        id: userId,
        createdAt: timestamp,
      }),
      id: userId,
      email: serverUser.email,
      role: serverUser.role,
      status: serverUser.status,
      createdAt: existing?.createdAt ?? timestamp,
      lastActiveAt: timestamp,
    } as User;

    const hasProfile = current.profiles.some((p) => p.userId === userId);

    return {
      ...current,
      users: existing
        ? current.users.map((u) => (u.id === userId ? user : u))
        : [...current.users, user],
      credentials: [
        ...current.credentials.filter((c) => c.userId !== userId),
        { userId, salt, hash, resetToken: null, resetExpiresAt: null },
      ],
      profiles: hasProfile
        ? current.profiles
        : [
            ...current.profiles,
            {
              id: userId,
              userId,
              fullName: fullName.trim(),

              institution: '',
              faculty: '',
              department: '',
              programme: '',
              level: '',
              expectedGraduationYear: null,
              avatarDataUrl: null,
              gradingSystemId: null,
              termStructure: 'SEMESTER',
              onboardingCompletedAt: null,
            },
          ],
      preferences: current.preferences[userId]
        ? current.preferences
        : { ...current.preferences, [userId]: { ...DEFAULT_PREFERENCES } },
      sessionUserId: userId,
    };
  });

  await pullAccount();
}

/** How long a sign-in will wait for the account to arrive before continuing. */
const FIRST_PULL_MS = 10_000;

/**
 * Waits for the account's data to arrive, but not indefinitely.
 *
 * This is awaited rather than fired and forgotten because of what happens in the
 * gap: the router decides where to send someone from the profile it can see, and
 * a device that has not pulled one yet has no profile at all — so a student with
 * a complete account was shown the onboarding form, filled it in, and landed on
 * an empty dashboard. Waiting means the first thing they see is their own work.
 *
 * The cap matters as much as the wait. A slow network or a failing sync must not
 * hold someone out of an app that works offline, so when the time is up the
 * sign-in proceeds and the background loop keeps trying.
 */
async function pullAccount(): Promise<void> {
  await Promise.race([
    syncNow(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, FIRST_PULL_MS);
    }),
  ]);
}


/**
 * True when the API answered. A transport failure means the server had no say,
 * and the device's own copy is then the best available authority.
 */
function serverSpoke(error: unknown): error is ApiError {
  return error instanceof ApiError && !error.isOffline;
}

/**
 * Claims an account that only ever existed on this device.
 *
 * Students who signed up before AcadMap kept accounts on the server have a real
 * account with real work in it, and an id this browser invented. The server has
 * never heard of them, so it rightly rejects the sign-in — and no amount of
 * retrying will help, because the password cannot be replayed from the PBKDF2
 * hash the device stored.
 *
 * So the moment the password is typed correctly is the only moment the account
 * can be handed over, and this takes it: the typed password is checked against
 * this device's own credential first — which is what proves the person owns the
 * local account rather than merely knowing the address — and only then is the
 * account registered for real. The device's rows are then moved onto the id the
 * server issued and the sync watermark is cleared so all of them upload as new.
 *
 * Returns `null` when there is nothing to claim, leaving the server's original
 * answer to stand. In particular a `409` means somebody already holds that
 * address on the server, and then the failed sign-in was simply a failed
 * sign-in: saying "email already taken" there would be both confusing and a way
 * to enumerate accounts.
 */
async function claimLocalAccount(email: string, password: string): Promise<AuthResult | null> {
  const db = getDatabase();
  const local = db.users.find((u) => u.email === email);
  const credential = local ? db.credentials.find((c) => c.userId === local.id) : undefined;
  if (!local || !credential) return null;
  if (local.status !== 'ACTIVE') return null;

  const hash = await hashPassword(password, credential.salt);
  if (!safeEqual(hash, credential.hash)) return null;

  const fullName = db.profiles.find((p) => p.userId === local.id)?.fullName ?? '';

  let serverUser: SessionUser;
  try {
    ({ user: serverUser } = await api.register({ email, password, fullName }));
  } catch (error) {
    if (error instanceof ApiError && error.status !== 409) {
      return { ok: false, error: error.message };
    }
    return null;
  }

  update((current) => rekeyIds(current, local.id, serverUser.id));
  // Both watermarks go: the old id will never be used again, and the new id must
  // start from nothing so the whole account is pulled fresh.
  forgetSyncState(local.id);
  forgetSyncState(serverUser.id);
  /*
   * And every row is queued for upload. The server has never seen this account,
   * so all of it is new — and the queue entries written before the move name the
   * old ids, which no longer exist. Without this the profile in particular would
   * never arrive: its id is the user id, so re-keying renamed it.
   */
  enqueueAllRows();


  await mirrorAccount(serverUser, password, fullName);
  trackEvent('app_opened', serverUser.id);
  return { ok: true, userId: serverUser.id };
}

export async function register(
  email: string,
  password: string,
  fullName: string,
): Promise<AuthResult> {
  const normalized = email.trim().toLowerCase();

  try {
    const { user } = await api.register({ email: normalized, password, fullName });
    await mirrorAccount(user, password, fullName);
    trackEvent('registered', user.id);
    return { ok: true, userId: user.id };
  } catch (error) {
    // "Email already taken", a weak password, a rate limit: the server's answer
    // is the real one and must reach the student unchanged.
    if (serverSpoke(error)) return { ok: false, error: error.message };
  }

  /*
   * No connection. The account is created on the device so the student can start
   * working immediately, and it becomes a real account when they next register or
   * sign in online.
   */
  const db = getDatabase();
  if (db.users.some((u) => u.email === normalized)) {
    return { ok: false, error: 'An account with this email already exists.' };
  }

  const salt = randomHex();
  const hash = await hashPassword(password, salt);
  const userId = uid();
  const timestamp = nowIso();

  const user: User = {
    id: userId,
    email: normalized,
    role: normalized === OWNER_EMAIL ? 'OWNER' : 'STUDENT',
    status: 'ACTIVE',
    createdAt: timestamp,
    lastActiveAt: timestamp,
  };

  update((current) => ({
    ...current,
    users: [...current.users, user],
    credentials: [
      ...current.credentials,
      { userId, salt, hash, resetToken: null, resetExpiresAt: null },
    ],
    profiles: [
      ...current.profiles,
      {
        id: userId,
        userId,
        fullName: fullName.trim(),

        institution: '',
        faculty: '',
        department: '',
        programme: '',
        level: '',
        expectedGraduationYear: null,
        avatarDataUrl: null,
        gradingSystemId: null,
        termStructure: 'SEMESTER',
        onboardingCompletedAt: null,
      },
    ],
    preferences: { ...current.preferences, [userId]: { ...DEFAULT_PREFERENCES } },
    sessionUserId: userId,
  }));

  trackEvent('registered', userId);
  return { ok: true, userId };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const normalized = email.trim().toLowerCase();

  try {
    const { user } = await api.login({ email: normalized, password });
    if (user.status === 'SUSPENDED') {
      return { ok: false, error: 'This account is suspended. Contact AcadMap support.' };
    }

    await mirrorAccount(user, password);
    trackEvent('app_opened', user.id);
    return { ok: true, userId: user.id };
  } catch (error) {
    if (serverSpoke(error)) {
      // The details may be right and the account simply older than the server.
      const claimed = await claimLocalAccount(normalized, password);
      return claimed ?? { ok: false, error: error.message };
    }
  }

  /* ---- offline: fall back to the credential this device stored ---- */


  const db = getDatabase();
  const user = db.users.find((u) => u.email === normalized);
  const credential = user ? db.credentials.find((c) => c.userId === user.id) : undefined;

  // Same message for unknown email and wrong password (no account enumeration).
  if (!user || !credential) {
    return {
      ok: false,
      error: 'Incorrect email or password, or no connection to check them against.',
    };
  }
  if (user.status === 'SUSPENDED') {
    return { ok: false, error: 'This account is suspended. Contact AcadMap support.' };
  }
  if (user.status === 'DELETED') return { ok: false, error: 'Incorrect email or password.' };

  const hash = await hashPassword(password, credential.salt);
  if (!safeEqual(hash, credential.hash)) {
    return { ok: false, error: 'Incorrect email or password.' };
  }

  update((current) => ({
    ...current,
    sessionUserId: user.id,
    users: current.users.map((u) =>
      u.id === user.id ? { ...u, lastActiveAt: nowIso() } : u,
    ),
  }));

  trackEvent('app_opened', user.id);
  return { ok: true, userId: user.id };
}


/**
 * Keeps the owner role in step with `OWNER_EMAIL`.
 *
 * The role is stored on the account row when it is created, so an account
 * registered before the owner address was configured would stay a student for
 * ever. Running this at startup promotes the designated address and demotes any
 * other row still marked OWNER, which also means changing `VITE_OWNER_EMAIL`
 * hands admin over cleanly instead of leaving two owners behind.
 */
export function syncOwnerRole(): void {
  const users = getDatabase().users;
  const stale = users.some((u) => (u.email === OWNER_EMAIL) !== (u.role === 'OWNER'));
  if (!stale) return;

  update((current) => ({
    ...current,
    users: current.users.map((u) => ({
      ...u,
      role: u.email === OWNER_EMAIL ? 'OWNER' : 'STUDENT',
    })),
  }));
}

/**
 * Signs out here and on the server.
 *
 * The local session is cleared first so the UI responds immediately, and the
 * server call is not awaited: a failed request must not leave someone stuck on a
 * screen they asked to leave. The cookie is dropped by the API when it answers,
 * and expires on its own if it never does.
 *
 * The sync watermark is deliberately kept. It belongs to the device, not the
 * session, and discarding it would make the next sign-in re-download the whole
 * account for no reason. The background loop is left running for the same
 * reason: with no session it does nothing, and it is then already in place for
 * whoever signs in next.
 */
export function logout(): void {
  update((current) => ({ ...current, sessionUserId: null }));
  void api.logout().catch(() => {});
}



/**
 * What happened when recovery was requested.
 *
 * `sent` distinguishes the two honest outcomes, because the UI must not say
 * "check your email" when no email was sent — that was the original complaint.
 * A `code` comes back only from the offline path, where this device issues a
 * recovery code itself because it cannot reach the server.
 */
export type ResetRequestResult =
  | { ok: true; sent: true }
  | { ok: true; sent: false; code: string }
  | { ok: false; error: string };

/**
 * Starts account recovery.
 *
 * The server owns this: it holds the account, and it is the only side that can
 * send mail. It answers the same way whether or not the address is registered,
 * so nothing here reveals who has an account either.
 *
 * With no connection the device falls back to issuing a local recovery code,
 * which is all a purely local account ever had. That path is genuinely useful —
 * a student who cannot reach the network can still get back into the app on this
 * device — but it is reported as `sent: false` so the screen tells the truth.
 */
export async function requestPasswordReset(email: string): Promise<ResetRequestResult> {
  const normalized = email.trim().toLowerCase();

  try {
    await api.requestPasswordReset({ email: normalized });
    return { ok: true, sent: true };
  } catch (error) {
    // A missing mail provider (503), a rate limit (429) or a provider failure
    // (502) are all real answers the student needs to see.
    if (serverSpoke(error)) return { ok: false, error: error.message };
  }

  const db = getDatabase();
  const user = db.users.find((u) => u.email === normalized);
  if (!user) {
    return {
      ok: false,
      error: 'No connection, and this device does not know that email address.',
    };
  }

  const code = randomHex(12);
  const expires = new Date(Date.now() + 30 * 60_000).toISOString();
  update((current) => ({
    ...current,
    credentials: current.credentials.map((c) =>
      c.userId === user.id ? { ...c, resetToken: code, resetExpiresAt: expires } : c,
    ),
  }));
  return { ok: true, sent: false, code };
}

/**
 * Finishes recovery with either an emailed link's token or an offline code.
 *
 * The server is asked first. If it declines, the same value is tried against
 * this device's own code, so someone recovering offline is not turned away by an
 * answer about a token the server never issued.
 */
export async function resetPassword(token: string, password: string): Promise<AuthResult> {
  const trimmed = token.trim();
  let serverError: string | null = null;

  try {
    const { user } = await api.resetPassword({ token: trimmed, password });
    // A successful reset signs this device in, so mirror the account as a
    // sign-in would and clear any stale local recovery code.
    await mirrorAccount(user, password);
    update((current) => ({
      ...current,
      credentials: current.credentials.map((c) =>
        c.userId === user.id ? { ...c, resetToken: null, resetExpiresAt: null } : c,
      ),
    }));
    return { ok: true, userId: user.id };
  } catch (error) {
    if (serverSpoke(error)) serverError = error.message;
  }

  const credential = getDatabase().credentials.find((c) => c.resetToken === trimmed);
  if (!credential) {
    return { ok: false, error: serverError ?? 'This recovery code is not valid.' };
  }
  if (credential.resetExpiresAt && credential.resetExpiresAt < nowIso()) {
    return { ok: false, error: 'This recovery code has expired. Request a new one.' };
  }

  const salt = randomHex();
  const hash = await hashPassword(password, salt);
  update((current) => ({
    ...current,
    credentials: current.credentials.map((c) =>
      c.userId === credential.userId
        ? { ...c, salt, hash, resetToken: null, resetExpiresAt: null }
        : c,
    ),
  }));
  return { ok: true, userId: credential.userId };
}


export async function changePassword(
  userId: ID,
  currentPassword: string,
  newPassword: string,
): Promise<AuthResult> {
  const credential = getDatabase().credentials.find((c) => c.userId === userId);
  if (!credential) return { ok: false, error: 'Account not found.' };

  const existing = await hashPassword(currentPassword, credential.salt);
  if (!safeEqual(existing, credential.hash)) {
    return { ok: false, error: 'Your current password is incorrect.' };
  }

  const salt = randomHex();
  const hash = await hashPassword(newPassword, salt);
  update((current) => ({
    ...current,
    credentials: current.credentials.map((c) =>
      c.userId === userId ? { ...c, salt, hash } : c,
    ),
  }));
  return { ok: true, userId };
}
