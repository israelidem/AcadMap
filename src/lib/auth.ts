/**
 * Authentication (client side).
 *
 * One rule decides everything in this file: **the account lives on the server**.
 * The device keeps a mirror of it so the app works offline, but the mirror is
 * never the authority.
 *
 * That is the fix for the bug this file used to cause. Registration could
 * previously complete in the browser alone — the account existed only in this
 * localStorage, with an id this browser invented — so the same details on a second
 * device found nothing to sign into and the student was walked through onboarding
 * again. Sign-in also had an offline fallback against a locally stored PBKDF2
 * hash, which meant a device could believe in an account the server had never
 * heard of, and hand-written hashing and reset tokens lived here in application
 * code.
 *
 * All of that is gone. Passwords, sessions, reset tokens and account deletion are
 * Better Auth's, over `/api/auth/*`; this module only:
 *
 *   1. calls the library,
 *   2. mirrors the confirmed account into the local store, keyed by the server's
 *      user id so every synced row belongs to the same student everywhere,
 *   3. waits briefly for the first pull so the student lands on their own data
 *      rather than an empty onboarding form.
 *
 * The consequence is deliberate: creating an account, or signing in on a *new*
 * device, needs a connection. Once signed in, the session and the data are on the
 * device and everything keeps working offline.
 */

import { createAuthClient } from 'better-auth/react';

import type { ID, User } from '@shared/types';
import { DEFAULT_PREFERENCES, getDatabase, update } from './store';
import { nowIso } from './utils';
import { trackEvent } from './analytics';
import { syncNow } from './sync';

/**
 * The auth client.
 *
 * `baseURL` is left to default to the page's own origin: the API is served from
 * the same deployment, and hard-coding an origin is how a preview deployment ends
 * up authenticating against production. `basePath` matches `api/auth/[...all].ts`.
 */
export const authClient = createAuthClient({ basePath: '/api/auth' });

/**
 * The single designated owner account.
 *
 * The server decides the real role when the account is created (see
 * `api/_lib/auth.ts`); this copy exists only so the local mirror can show the
 * admin area without waiting for a round trip.
 */
export const OWNER_EMAIL = (import.meta.env.VITE_OWNER_EMAIL ?? 'israelidem20@gmail.com')
  .toString()
  .trim()
  .toLowerCase();

export interface AuthResult {
  ok: boolean;
  error?: string;
  userId?: ID;
}

/** The fields this app needs from Better Auth's user object. */
interface ServerUser {
  id: string;
  email: string;
  name?: string | null;
  role?: string | null;
  status?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

const OFFLINE_MESSAGE =
  'No connection. Signing in on a new device needs the internet the first time — ' +
  'after that AcadMap works offline.';

/**
 * Turns whatever went wrong into something a student can act on.
 *
 * A Better Auth error carries the server's own message, which is the useful one
 * ("Invalid email or password", "User already exists"). A request that never
 * reached the server has no status, and saying "incorrect password" there would
 * be a lie.
 */
function messageFor(error: { message?: string; status?: number } | null): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (!error.status) return OFFLINE_MESSAGE;
  return error.message?.trim() || 'Something went wrong. Please try again.';
}

/* -------------------------------------------------------------------------- */
/* The local mirror                                                           */
/* -------------------------------------------------------------------------- */

/** How long a sign-in waits for the account to arrive before continuing. */
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
 * The cap matters as much as the wait. A slow network must not hold someone out
 * of an app that works offline, so when the time is up the sign-in proceeds and
 * the background loop keeps trying.
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
 * Brings the device's mirror in line with the account the server just confirmed.
 *
 * The server's user id is adopted verbatim, because every synced row is keyed by
 * it: a locally invented id would make one student look like two accounts.
 *
 * The profile and preference rows are created only when missing — a device that
 * already knows this account must not have its profile blanked by a sign-in, and
 * the real profile is about to arrive from the server anyway.
 */
async function mirrorAccount(serverUser: ServerUser, fullName = ''): Promise<void> {
  const timestamp = nowIso();
  const userId = serverUser.id;

  update((current) => {
    const existing = current.users.find((u) => u.id === userId);

    const user: User = {
      ...(existing ?? { id: userId, createdAt: timestamp }),
      id: userId,
      email: serverUser.email,
      role: (serverUser.role as User['role']) ?? 'STUDENT',
      status: (serverUser.status as User['status']) ?? 'ACTIVE',
      createdAt: existing?.createdAt ?? timestamp,
      lastActiveAt: timestamp,
    } as User;

    const hasProfile = current.profiles.some((p) => p.userId === userId);

    return {
      ...current,
      users: existing
        ? current.users.map((u) => (u.id === userId ? user : u))
        : [...current.users, user],
      profiles: hasProfile
        ? current.profiles
        : [
            ...current.profiles,
            {
              id: userId,
              userId,
              fullName: (fullName || serverUser.name || '').trim(),
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

/* -------------------------------------------------------------------------- */
/* Register, sign in, sign out                                                */
/* -------------------------------------------------------------------------- */

export async function register(
  email: string,
  password: string,
  fullName: string,
): Promise<AuthResult> {
  const normalized = email.trim().toLowerCase();

  const { data, error } = await authClient.signUp.email({
    email: normalized,
    password,
    // Better Auth requires a name; the onboarding form refines it later.
    name: fullName.trim() || normalized.split('@')[0],
  });

  if (error || !data?.user) return { ok: false, error: messageFor(error) };

  await mirrorAccount(data.user as ServerUser, fullName);
  trackEvent('registered', data.user.id);
  return { ok: true, userId: data.user.id };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const normalized = email.trim().toLowerCase();

  const { data, error } = await authClient.signIn.email({ email: normalized, password });
  if (error || !data?.user) return { ok: false, error: messageFor(error) };

  const user = data.user as ServerUser;
  if (user.status === 'SUSPENDED') {
    return { ok: false, error: 'This account is suspended. Contact AcadMap support.' };
  }

  await mirrorAccount(user);
  trackEvent('app_opened', user.id);
  return { ok: true, userId: user.id };
}

/**
 * Signs out here and on the server.
 *
 * The local session is cleared first so the UI responds immediately, and the
 * server call is not awaited: a failed request must not leave someone stuck on a
 * screen they asked to leave.
 *
 * The sync watermark is deliberately kept. It belongs to the device, not the
 * session, and discarding it would make the next sign-in re-download the whole
 * account for no reason.
 */
export function logout(): void {
  update((current) => ({ ...current, sessionUserId: null }));
  void authClient.signOut().catch(() => {});
}

/**
 * Keeps the mirrored owner role in step with `OWNER_EMAIL`.
 *
 * Only ever touches this device's copy — the server's `role` column is what
 * actually gates the admin API, so this cannot grant anyone anything.
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

/* -------------------------------------------------------------------------- */
/* Recovery                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What happened when recovery was requested.
 *
 * `sent` exists because the UI must not say "check your email" when no email was
 * sent — that was the original complaint about this flow. There is no longer an
 * offline branch: only the server can mail a link, and a recovery code this
 * device invented could not change the password that actually guards the account.
 */
export type ResetRequestResult = { ok: true; sent: true } | { ok: false; error: string };

/**
 * Starts account recovery.
 *
 * The server answers the same way whether or not the address is registered, so
 * nothing here reveals who has an account. `redirectTo` is where the emailed link
 * lands; Better Auth appends the one-time token to it.
 */
export async function requestPasswordReset(email: string): Promise<ResetRequestResult> {
  const { error } = await authClient.requestPasswordReset({
    email: email.trim().toLowerCase(),
    redirectTo: `${window.location.origin}/recover`,
  });

  if (error) return { ok: false, error: messageFor(error) };
  return { ok: true, sent: true };
}

/** Finishes recovery with the token from the emailed link. */
export async function resetPassword(token: string, password: string): Promise<AuthResult> {
  const { error } = await authClient.resetPassword({
    token: token.trim(),
    newPassword: password,
  });

  if (error) return { ok: false, error: messageFor(error) };
  // Better Auth does not sign you in on reset, which is the safer default: the
  // new password is then typed once on purpose rather than assumed.
  return { ok: true };
}

export async function changePassword(
  _userId: ID,
  currentPassword: string,
  newPassword: string,
): Promise<AuthResult> {
  const { error } = await authClient.changePassword({
    currentPassword,
    newPassword,
    // Other devices keep their sessions: a password change is routine hygiene,
    // not a breach, and signing a student out of their phone is a surprise.
    revokeOtherSessions: false,
  });

  if (error) return { ok: false, error: messageFor(error) };
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Deleting the account                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Deletes the signed-in account, everywhere.
 *
 * The current password is required by the server before it will do this, which is
 * what stops a borrowed unlocked phone from wiping someone's degree history. On
 * the server every table cascades from the account row, so the academic data goes
 * with it rather than being left orphaned; here the device's mirror is dropped so
 * a deleted account cannot linger on the screen.
 */
export async function deleteAccount(password: string): Promise<AuthResult> {
  const { error } = await authClient.deleteUser({ password });
  if (error) return { ok: false, error: messageFor(error) };

  const userId = getDatabase().sessionUserId;
  update((current) => ({
    ...current,
    users: current.users.filter((u) => u.id !== userId),
    sessionUserId: null,
  }));

  return { ok: true };
}
