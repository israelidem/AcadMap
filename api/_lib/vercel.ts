/**
 * Lets a Web-standard handler run as a Vercel Node function.
 *
 * Every endpoint in this project is written as `(Request) => Promise<Response>`,
 * which is the shape the Edge runtime accepts — and the shape the Vite dev
 * plugin feeds during `npm run dev`. Vercel's Node runtime, which is where these
 * functions must live because Better Auth needs a TCP socket to Postgres, calls
 * the default export as `(req, res)` instead. Nothing warns about the mismatch:
 * the handler receives Node's `IncomingMessage`, calls something like
 * `request.headers.get(...)` on it, throws, and the platform reports a bare
 * FUNCTION_INVOCATION_FAILED with no clue as to why. A handler that happens not
 * to touch the request simply hangs until the function times out, because a
 * returned `Response` is not something Vercel reads — only `res.end()` ends the
 * request.
 *
 * So this adapter accepts both calling conventions, and each endpoint wraps its
 * handler in it:
 *
 *   export default toVercelHandler(handler);
 *
 * Called with a single `Request` (dev server, tests) it delegates and returns
 * the `Response` untouched. Called with `(req, res)` (production) it converts,
 * delegates, and writes the result onto the Node response.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export type WebHandler = (request: Request) => Response | Promise<Response>;

/** Node's IncomingMessage → a Web Request. */
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else headers.set(key, value);
  }

  // Behind Vercel's proxy the connection is always HTTPS at the edge, and the
  // forwarded headers are what the app's own origin checks compare against.
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https';
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `${proto}://${host}`);

  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }

  /*
   * Vercel parses JSON and form bodies before the handler runs, and consuming an
   * already-consumed stream would hang. Prefer the parsed body and re-serialise
   * it; fall back to reading the stream when the platform left it alone (which
   * is what happens locally and for content types Vercel does not touch).
   */
  const parsed = (req as IncomingMessage & { body?: unknown }).body;
  let body: string | undefined;

  if (typeof parsed === 'string') {
    body = parsed;
  } else if (Buffer.isBuffer(parsed)) {
    body = parsed.toString('utf8');
  } else if (parsed !== undefined && parsed !== null) {
    body = JSON.stringify(parsed);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks).toString('utf8') || undefined;
  }

  // The original length no longer applies once the body has been re-serialised.
  headers.delete('content-length');
  return new Request(url, { method, headers, body });
}

/** Copies a Web Response onto Node's ServerResponse. */
async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  // Better Auth sets more than one Set-Cookie on sign-in; a plain iteration folds
  // them into a single malformed header, which loses the session.
  const cookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    res.setHeader(key, value);
  });
  if (cookies.length > 0) res.setHeader('Set-Cookie', cookies);

  res.statusCode = response.status;
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * Wraps a Web handler so it works under both calling conventions.
 *
 * The two-parameter signature is deliberate: Vercel decides how to call the
 * default export from its arity, so this must not be shortened to one argument.
 */
export function toVercelHandler(handler: WebHandler) {
  return async function vercelHandler(
    requestOrReq: Request | IncomingMessage,
    res?: ServerResponse,
  ): Promise<Response | void> {
    if (!res) return handler(requestOrReq as Request);

    const response = await handler(await toWebRequest(requestOrReq as IncomingMessage));
    await sendWebResponse(response, res);
  };
}
