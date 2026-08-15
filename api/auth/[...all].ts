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

import { auth } from '../_lib/auth.js';
import { toVercelHandler } from '../_lib/vercel.js';

/**
 * Puts the original path back, then lets Better Auth dispatch.
 *
 * Wrapped in `toVercelHandler` like every other endpoint: Vercel's Node runtime
 * calls the default export as `(req, res)`, so Better Auth would otherwise be
 * handed a Node `IncomingMessage` where it expects a `Request`. The `.js` on the
 * imports above matters for the same reason — Vercel transpiles these files
 * instead of bundling them, and Node's ESM loader cannot resolve an extensionless
 * specifier at runtime.
 *
 * Vercel's router matched only one segment of this catch-all in production:
 * `/api/auth/get-session` reached the function while `/api/auth/sign-in/email`
 * answered 404 NOT_FOUND from the edge, which meant nobody could sign in or
 * register. `vercel.json` therefore rewrites the whole base path here explicitly
 * and carries the real path in an `authPath` query parameter, because a rewritten
 * request arrives wearing the destination's URL. Better Auth routes on the URL,
 * so it has to be restored before the library sees it — and `authPath` removed,
 * or it would travel on as a stray parameter.
 *
 * Locally there is no rewrite and no `authPath`, so the request passes straight
 * through.
 */
export default toVercelHandler(async (request) => {
  const url = new URL(request.url);
  const authPath = url.searchParams.get('authPath');
  if (!authPath) return auth.handler(request);

  url.searchParams.delete('authPath');
  const restored = new URL(`/api/auth/${authPath}${url.search}`, url.origin);

  // Rebuilt rather than cloned: a Request carrying a stream body cannot be
  // re-created without Node's `duplex` option, and the body is already text here.
  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();

  return auth.handler(
    new Request(restored, { method: request.method, headers: request.headers, body }),
  );
});
