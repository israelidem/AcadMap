/**
 * The Better Auth instance: the single source of truth for who is signed in.
 *
 * This replaces a hand-rolled auth layer — PBKDF2 in application code, session
 * rows looked up by hand, reset tokens minted here, and a client that could
 * mint an account entirely in the browser. That last part is what made accounts
 * fail to follow their owner to a second device: a "registered" student might
 * exist only in one browser's localStorage, so signing in elsewhere found
 * nothing to load and started onboarding again. Sessions, hashing, rotation and
 * reset now belong to a library that is audited and updated, and an account only
 * exists once Postgres says it does.
 *
 * Runtime notes that are not optional:
 *
 *   * Node, not Edge. Better Auth talks to Postgres over a `pg` Pool, which needs
 *     TCP sockets that the Edge runtime does not have. Every handler under `api/`
 *     therefore runs on the Node runtime.
 *   * `DATABASE_URL` must be Neon's *pooled* endpoint (the host containing
 *     `-pooler`). A serverless function is short-lived and may run in many
 *     instances at once; pointing a Pool at the direct endpoint exhausts Neon's
 *     connection limit under very ordinary traffic.
 *   * The `sql()` helper in `db.ts` still uses Neon's HTTP endpoint and is
 *     untouched. Two paths to the same database is deliberate: application
 *     queries stay dependency-free, and only auth pays for a driver.
 *
 * Environment:
 *   BETTER_AUTH_SECRET  signs session cookies and reset tokens. Rotating it signs
 *                       every student out; losing it is not recoverable.
 *   BETTER_AUTH_URL     the deployment's own origin, e.g. https://acadmap.app.
 *                       Used to build links in email and to check callbacks.
 *   OWNER_EMAIL         promoted to OWNER when it registers; nothing else grants it.
 *   BETTER_AUTH_API_KEY authorises the hosted Better Auth dashboard (see `dash`
 *                       below). Absent, the dashboard simply cannot connect;
 *                       leaked, it is an admin key — rotate it in the dashboard.
 */

import { dash } from '@better-auth/infra';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

import { passwordResetEmail, sendMail } from './mail.js';

const RESET_VALID_MINUTES = 60;

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

const ownerEmail = env('OWNER_EMAIL').toLowerCase();

/**
 * The app's own origin.
 *
 * `APP_ORIGIN` is honoured as a fallback because it already exists for the split
 * frontend/API deployment, and having two variables disagree about the origin is
 * how reset links end up pointing at the wrong host.
 */
const baseURL = env('BETTER_AUTH_URL') || env('APP_ORIGIN') || undefined;

/**
 * Origins allowed to call the auth endpoints.
 *
 * In production this stays empty, which leaves Better Auth's default: only
 * `baseURL` itself. Locally, Vite moves to 5174 (then 5175, …) whenever 5173 is
 * already taken, and every sign-in then fails with "Invalid origin" against a
 * `BETTER_AUTH_URL` that names one fixed port — so development trusts localhost
 * on any port instead. Nothing here is read from the request, so it cannot be
 * used to widen trust in a deployment.
 */
const devOrigins =
  process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:*', 'http://127.0.0.1:*'];

export const auth = betterAuth({

  // A Pool, not a connection, so the driver can hand back a live socket across
  // invocations that share a warm container instead of shaking hands every time.
  database: new Pool({ connectionString: env('DATABASE_URL') }),

  secret: env('BETTER_AUTH_SECRET'),
  baseURL,
  trustedOrigins: devOrigins,
  // Matches api/auth/[...all].ts, which is where Vercel routes these requests.
  basePath: '/api/auth',

  /*
   * The hosted dashboard at dash.better-auth.com (student list, sessions,
   * sign-up graphs) instead of building an admin UI for the same data.
   *
   * This mounts `/api/auth/dash/*`, and those routes are powerful: listing and
   * exporting users, creating and deleting them, banning, revoking sessions,
   * impersonating. They authorise against `BETTER_AUTH_API_KEY` rather than a
   * student session, so that key is an admin credential — it belongs only in
   * the deployment's environment variables, and a key that has been pasted into
   * a screenshot, a chat or a commit must be rotated.
   *
   * The key is read from `process.env.BETTER_AUTH_API_KEY` by default, so it is
   * deliberately not named here.
   */
  plugins: [dash()],


  emailAndPassword: {
    enabled: true,
    /*
     * Verification is off for launch, so registering signs you straight in.
     *
     * The alternative would block every new student until an email arrives, and
     * a transactional email that silently fails — unverified sender domain, key
     * absent in this environment — locks out sign-up entirely. Flip this to true
     * once mail has been observed working in production; the mailer below is
     * already wired, so nothing else changes.
     */
    requireEmailVerification: false,
    minPasswordLength: 8,

    async sendResetPassword({ user, url }) {
      const result = await sendMail({
        to: user.email,
        ...passwordResetEmail(url, RESET_VALID_MINUTES),
      });
      // Better Auth answers the caller with a generic success either way, so the
      // log is the only place the real reason survives. Throwing here would tell
      // an unauthenticated caller whether the address exists.
      if (!result.ok) console.error('[auth] reset email not sent:', result.error);
    },
  },

  user: {
    additionalFields: {
      /*
       * `input: false` on all three: these are the server's opinion of the
       * account, and a field the client may set is a field the client may lie
       * about. Without it, a crafted sign-up body could ask for role OWNER.
       */
      role: { type: 'string', required: false, defaultValue: 'STUDENT', input: false },
      status: { type: 'string', required: false, defaultValue: 'ACTIVE', input: false },
      lastSeenAt: { type: 'date', required: false, input: false },
    },

    /*
     * Lets a student delete their own account.
     *
     * Better Auth requires the current password (or a fresh session) before it
     * will do it, which is what stops a borrowed unlocked phone from wiping
     * someone's degree history. Every app table cascades from `user`, so the
     * academic data goes with the row rather than being orphaned.
     */
    deleteUser: { enabled: true },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    // Sliding window: a student who opens the app at least monthly is never
    // signed out, while an abandoned session still expires.
    updateAge: 60 * 60 * 24,
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: {
            ...user,
            // Decided here rather than at sign-up so it cannot be requested, and
            // so it holds however the account was created.
            role: ownerEmail !== '' && user.email.toLowerCase() === ownerEmail ? 'OWNER' : 'STUDENT',
          },
        }),
      },
    },
  },
});

/** The signed-in user for a request, or null. */
export async function currentUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}
