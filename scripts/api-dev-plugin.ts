/**
 * Serves the `api/` functions during `npm run dev`.
 *
 * Vite only serves the client, so without this the app would have no API to talk
 * to locally and `vercel dev` (CLI install + login + project linking) would be
 * required just to click through a signed-in page. The handlers are plain
 * `(Request) => Promise<Response>` functions, so a thin Node↔Web adapter is all
 * that is needed.
 *
 * Routing mirrors Vercel's file conventions:
 *   /api/profile              → api/profile.ts
 *   /api/share/abc123         → api/share/[token].ts
 *   /api/courses              → api/courses/index.ts (if the file form is absent)
 *   /api/auth/sign-in/email   → api/auth/[...all].ts   (catch-all, any depth)
 * Files and folders starting with `_` are private helpers and never routed.

 *
 * Handlers are loaded through Vite's SSR pipeline, so TypeScript, the `@shared`
 * alias and hot reloading all work: editing a handler takes effect on the next
 * request without restarting the server.
 *
 * Development only — in production Vercel runs these same files.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { loadEnv } from 'vite';

const API_DIR = 'api';

type Handler = (request: Request) => Response | Promise<Response>;

/** `[...all].ts` in a directory: owns that directory and everything below it. */
function catchAllIn(dir: string): string | null {
  const name = safeReaddir(dir).find((entry) => /^\[\.\.\..+\]\.(ts|js)$/.test(entry));
  return name ? join(dir, name) : null;
}

/**
 * Finds the handler file for a request path, honouring `[param]` and `[...all]`
 * segments.
 *
 * The catch-all case is what serves authentication in development: Better Auth
 * owns paths of varying depth under one base path (`/api/auth/get-session` but
 * also `/api/auth/sign-in/email`), so when a segment matches no file or folder,
 * the nearest catch-all above it takes the whole remainder — the same rule Vercel
 * applies in production. Without this, sign-in worked deployed and 404ed locally.
 *
 * @param segments Path segments after `/api/`, e.g. `['share', 'abc123']`.
 * @returns A path relative to the project root, or null when nothing matches.
 */
function resolveHandlerFile(root: string, segments: string[]): string | null {
  let dir = join(root, API_DIR);

  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;

    if (isLast) {
      for (const candidate of [`${segment}.ts`, `${segment}.js`]) {
        if (existsSync(join(dir, candidate))) return join(dir, candidate);
      }
      for (const candidate of ['index.ts', 'index.js']) {
        if (existsSync(join(dir, segment, candidate))) return join(dir, segment, candidate);
      }
      // Dynamic file, e.g. [token].ts — the value itself is read by the handler
      // from the URL, so the file name is all we need here. `[...all]` is
      // excluded from this pattern so a single-parameter route always wins.
      const dynamic = safeReaddir(dir).find((name) => /^\[(?!\.\.\.).+\]\.(ts|js)$/.test(name));
      return dynamic ? join(dir, dynamic) : catchAllIn(dir);
    }

    if (existsSync(join(dir, segment))) {
      dir = join(dir, segment);
      continue;
    }
    const dynamicDir = safeReaddir(dir).find((name) => /^\[(?!\.\.\.).+\]$/.test(name));
    if (!dynamicDir) return catchAllIn(dir);
    dir = join(dir, dynamicDir);
  }

  return null;
}


function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Node's IncomingMessage → a Web Request the handlers understand. */
async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else headers.set(key, value);
  }

  const method = req.method ?? 'GET';
  // Every endpoint takes JSON, so decoding to text keeps the adapter simple and
  // sidesteps the DOM/Node BufferSource typing mismatch.
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks).toString('utf8') || undefined;
  }

  return new Request(new URL(req.url ?? '/', origin), { method, headers, body });
}

/** Copies a Web Response onto Node's ServerResponse. */
async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  // Multiple Set-Cookie headers must survive the trip; getSetCookie keeps them
  // separate where a plain iteration would fold them into one string.
  const cookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    res.setHeader(key, value);
  });
  if (cookies.length > 0) res.setHeader('Set-Cookie', cookies);

  res.statusCode = response.status;
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

export function apiDevPlugin(): Plugin {
  return {
    name: 'acadmap:api-dev',
    apply: 'serve',

    config(_config, { mode }) {
      // The handlers read process.env directly (as they do on Vercel), so load
      // .env for the server side. Nothing here is exposed to the browser.
      const env = loadEnv(mode, process.cwd(), '');
      for (const key of [
        'DATABASE_URL',
        'OWNER_EMAIL',
        'APP_ORIGIN',
        'BETTER_AUTH_SECRET',
        'BETTER_AUTH_URL',
        'BREVO_API_KEY',
        'RESEND_API_KEY',
        'MAIL_FROM',
        'MAIL_REPLY_TO',
      ]) {
        if (env[key] && !process.env[key]) process.env[key] = env[key];
      }
      if (!process.env.DATABASE_URL) {
        console.warn(
          '[api] DATABASE_URL is not set — /api routes will fail. Copy .env.example to .env.',
        );
      }
      // Better Auth refuses to sign a cookie without a secret, so signing in
      // would fail with a stack trace rather than a message. Say so up front.
      if (!process.env.BETTER_AUTH_SECRET) {
        console.warn(
          '[api] BETTER_AUTH_SECRET is not set — sign-up and sign-in will fail. ' +
            'Add any long random string to .env.',
        );
      }
      // Reset links and cookie checks need to know where the app lives.
      process.env.BETTER_AUTH_URL ??= 'http://localhost:5173';

    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();

        const root = server.config.root;
        const pathname = new URL(url, 'http://localhost').pathname;
        const segments = pathname.replace(/^\/api\//, '').split('/').filter(Boolean);

        // `_lib` and friends are implementation details, not endpoints.
        if (segments.some((segment) => segment.startsWith('_'))) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const file = resolveHandlerFile(root, segments);
        if (!file) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `No API handler for /${segments.join('/')}` }));
          return;
        }

        try {
          const module = await server.ssrLoadModule(file);
          const handler = (module.default ?? module.handler) as Handler | undefined;
          if (typeof handler !== 'function') {
            throw new Error(`${file} does not export a default handler`);
          }

          const origin = `http://${req.headers.host ?? 'localhost:5173'}`;
          const response = await handler(await toWebRequest(req, origin));
          await sendWebResponse(response, res);
        } catch (error) {
          server.ssrFixStacktrace(error as Error);
          console.error(`[api] ${req.method} ${url} failed`, error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Internal error (see the dev server log)' }));
        }
      });
    },
  };
}
