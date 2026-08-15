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

import { toVercelHandler } from '../_lib/vercel';

/*
 * Wrapped, like every other endpoint: Vercel's Node runtime calls the default
 * export as `(req, res)`, and handing Better Auth a Node `IncomingMessage` in
 * place of a `Request` is what made this route unable to answer at all. See
 * `_lib/vercel.ts`.
 *
 * TEMPORARY: the auth module is loaded inside the handler rather than imported
 * at the top, and any failure is reported in the response. A module that throws
 * while loading takes the whole function down before it can answer, and Vercel
 * turns that into a bare FUNCTION_INVOCATION_FAILED with the reason visible only
 * in runtime logs. Loading it here makes the reason reachable. Restore the plain
 * top-level `import { auth } from '../_lib/auth'` once production is healthy.
 */
export default toVercelHandler(async (request) => {
  try {
    const { auth } = await import('../_lib/auth');
    return auth.handler(request);
  } catch (error) {
    const err = error as Error & { code?: string };
    return new Response(
      JSON.stringify(
        {
          error: 'auth module failed to load',
          name: err.name,
          code: err.code,
          message: err.message,
          stack: (err.stack ?? '').split('\n').slice(0, 8),
        },
        null,
        2,
      ),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }
});
