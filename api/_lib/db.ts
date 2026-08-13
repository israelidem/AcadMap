/**
 * Minimal, dependency-free Neon client.
 *
 * Neon exposes an HTTP SQL endpoint, so we can talk to Postgres with `fetch`
 * alone — no driver, no connection pooling, no paid add-ons. Every query is
 * parameterised ($1, $2, …); string interpolation into SQL is never allowed.
 */

const CONNECTION_STRING = process.env.DATABASE_URL ?? '';

/** Derives the Neon HTTP SQL endpoint from a standard Postgres URL. */
function endpoint(): string {
  if (!CONNECTION_STRING) throw new Error('DATABASE_URL is not configured');
  const url = new URL(CONNECTION_STRING);
  return `https://${url.hostname}/sql`;
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/**
 * Runs a parameterised query.
 *
 * @example
 * const { rows } = await sql<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
 */
export async function sql<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': CONNECTION_STRING,
      'Neon-Raw-Text-Output': 'false',
      'Neon-Array-Mode': 'false',
    },
    body: JSON.stringify({ query, params }),
  });

  if (!response.ok) {
    const detail = await response.text();
    // Never surface raw database errors to clients; log and throw a generic error.
    console.error('[db] query failed', response.status, detail.slice(0, 500));
    throw new Error('Database query failed');
  }

  const data = (await response.json()) as { rows?: T[]; rowCount?: number };
  return { rows: data.rows ?? [], rowCount: data.rowCount ?? data.rows?.length ?? 0 };
}

/** Convenience helper for single-row reads. */
export async function one<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T | null> {
  const { rows } = await sql<T>(query, params);
  return rows[0] ?? null;
}
