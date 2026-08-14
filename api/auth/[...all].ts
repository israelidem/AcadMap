/**
 * Every authentication route, in one function.
 *
 * Better Auth exposes its endpoints under a single base path, so
 * `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/get-session`,
 * `/api/auth/sign-out`, `/api/auth/forget-password`, `/api/auth/reset-password`
 * and `/api/auth/delete-user` all arrive here and are dispatched by the library.
 * The filename is Vercel's catch-all syntax; `basePath` in `_lib/auth.ts` must
 * match this directory or the library will not recognise its own URLs.
 *
 * This replaces five hand-written endpoints. Password hashing (scrypt),
 * timing-safe comparison, session rotation on sign-in, single-use reset tokens
 * and the generic "if that address exists" reply are all the library's, and are
 * no longer things this codebase can get subtly wrong.
 *
 * Runs on the Node runtime (the default): the Postgres driver needs TCP.
 */

import { auth } from '../_lib/auth';

export default function handler(request: Request): Promise<Response> {
  return auth.handler(request);
}
