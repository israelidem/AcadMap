/**
 * TEMPORARY diagnostic #2 — delete with `diag.ts`.
 *
 * Tests one hypothesis: that Vercel's Node runtime is calling these handlers
 * with `(req, res)` while every file in `api/` is written for the Web signature
 * `(Request) => Response`. That mismatch would explain both production symptoms
 * exactly — `diag.ts` returns a `Response` that nobody reads and never calls
 * `res.end()`, so the request hangs until the function times out, while every
 * real handler touches `request.headers.get(...)` on what is actually a Node
 * `IncomingMessage` and throws immediately, which is the fast
 * FUNCTION_INVOCATION_FAILED we see. Locally the dev plugin adapts Node to Web,
 * which is why the same code answers 200 on this machine.
 *
 * So this file deliberately uses the Node signature. If it answers, the runtime
 * wants `(req, res)` and the API needs an adapter; if it hangs too, it does not.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(_req: any, res: any): Promise<void> {
  const report: Record<string, unknown> = {
    signature: 'node (req, res)',
    node: process.version,
    envPresent: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      BETTER_AUTH_SECRET: Boolean(process.env.BETTER_AUTH_SECRET),
      BETTER_AUTH_URL: Boolean(process.env.BETTER_AUTH_URL),
      BETTER_AUTH_API_KEY: Boolean(process.env.BETTER_AUTH_API_KEY),
      OWNER_EMAIL: Boolean(process.env.OWNER_EMAIL),
    },
  };

  const withTimeout = async (work: Promise<unknown>, ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'TIMED OUT'>((resolve) => {
      timer = setTimeout(() => resolve('TIMED OUT'), ms);
    });
    try {
      return await Promise.race([work.then(() => 'loaded' as const), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  for (const specifier of ['pg', 'better-auth', '@better-auth/infra', './_lib/auth']) {
    try {
      report[specifier] = await withTimeout(import(specifier), 2000);
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

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  res.end(JSON.stringify(report, null, 2));
}
