/**
 * TEMPORARY diagnostic endpoint — delete once the deployment is healthy.
 *
 * Every function under `api/` currently answers 500 FUNCTION_INVOCATION_FAILED
 * in production while behaving correctly locally, which means something fails
 * while the module graph loads rather than inside a handler. A crash at load
 * leaves no response for Vercel to show, so the reason only exists in the
 * runtime log; this endpoint imports the same graph inside a try/catch and
 * reports what it caught instead.
 *
 * It deliberately imports nothing at the top level, so it can answer even when
 * `_lib/auth` cannot load. It reports which environment variables are *present*
 * — never their values — plus the error and the Node version.
 */

export default async function handler(_request: Request): Promise<Response> {
  const report: Record<string, unknown> = {
    node: process.version,
    envPresent: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      BETTER_AUTH_SECRET: Boolean(process.env.BETTER_AUTH_SECRET),
      BETTER_AUTH_URL: Boolean(process.env.BETTER_AUTH_URL),
      BETTER_AUTH_API_KEY: Boolean(process.env.BETTER_AUTH_API_KEY),
      OWNER_EMAIL: Boolean(process.env.OWNER_EMAIL),
    },
  };

  for (const specifier of ['pg', 'better-auth', '@better-auth/infra', './_lib/auth']) {
    try {
      await import(specifier);
      report[specifier] = 'loaded';
    } catch (error) {
      const err = error as Error & { code?: string };
      report[specifier] = {
        name: err.name,
        code: err.code,
        message: err.message,
        stack: (err.stack ?? '').split('\n').slice(0, 6),
      };
    }
  }

  return new Response(JSON.stringify(report, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
