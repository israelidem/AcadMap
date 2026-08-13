/**
 * Authentication for the local-first MVP.
 *
 * Passwords are never stored in plain text: each account gets a random salt and
 * a PBKDF2-SHA256 derived key. When the app is pointed at the Neon-backed API
 * the same flow runs server-side (see `api/auth.ts`), which is also where the
 * owner/admin role is authoritatively enforced.
 */

import type { ID, User } from '@shared/types';
import { DEFAULT_PREFERENCES, getDatabase, update } from './store';
import { nowIso, uid } from './utils';
import { trackEvent } from './analytics';

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

export async function register(
  email: string,
  password: string,
  fullName: string,
): Promise<AuthResult> {
  const normalized = email.trim().toLowerCase();
  const db = getDatabase();

  if (db.users.some((u) => u.email === normalized)) {
    return { ok: false, error: 'An account with this email already exists.' };
  }

  const salt = randomHex();
  const hash = await hashPassword(password, salt);
  const userId = uid('usr');
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
  const db = getDatabase();
  const user = db.users.find((u) => u.email === normalized);
  const credential = user ? db.credentials.find((c) => c.userId === user.id) : undefined;

  // Same message for unknown email and wrong password (no account enumeration).
  if (!user || !credential) return { ok: false, error: 'Incorrect email or password.' };
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

export function logout(): void {
  update((current) => ({ ...current, sessionUserId: null }));
}

/**
 * Account recovery without email infrastructure: a single-use token is issued
 * and shown to the student. Swap for an emailed link when a free mail provider
 * is approved.
 */
export function requestPasswordReset(email: string): { token: string } | { error: string } {
  const normalized = email.trim().toLowerCase();
  const db = getDatabase();
  const user = db.users.find((u) => u.email === normalized);
  if (!user) return { error: 'No account uses that email address.' };

  const token = randomHex(12);
  const expires = new Date(Date.now() + 30 * 60_000).toISOString();
  update((current) => ({
    ...current,
    credentials: current.credentials.map((c) =>
      c.userId === user.id ? { ...c, resetToken: token, resetExpiresAt: expires } : c,
    ),
  }));
  return { token };
}

export async function resetPassword(token: string, password: string): Promise<AuthResult> {
  const db = getDatabase();
  const credential = db.credentials.find((c) => c.resetToken === token.trim());
  if (!credential) return { ok: false, error: 'This recovery code is not valid.' };
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
