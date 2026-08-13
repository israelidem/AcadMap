/**
 * Applies db/schema.sql to the Neon database in DATABASE_URL.
 *
 *   npm run db:push
 *
 * Neon exposes an HTTP SQL endpoint, so this needs neither psql nor a driver —
 * the same dependency-free approach the API uses in api/_lib/db.ts.
 *
 * The endpoint runs one statement per request, so the file is split locally.
 * The splitter understands the quoting that actually appears in the schema:
 * single-quoted strings, dollar-quoted function bodies ($$ … $$), line comments
 * and block comments. Semicolons inside any of those are not statement breaks.
 *
 * The script stops at the first failing statement and prints it, so a partially
 * applied schema is easy to diagnose. Statements use IF NOT EXISTS where
 * possible, making a re-run safe.
 *
 * Caveat: each request is its own implicit transaction, so the BEGIN/COMMIT in
 * the file are no-ops here. That is acceptable because the schema is idempotent
 * — re-running after a failure simply continues where it left off.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env reader — avoids depending on a Node version that has --env-file. */
async function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of ['.env', '.env.local']) {
    let text;
    try {
      text = await readFile(join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*DATABASE_URL\s*=\s*(.*)\s*$/.exec(line);
      if (match) return match[1].replace(/^["']|["']$/g, '').trim();
    }
  }
  return '';
}

/** Splits a SQL script into statements, respecting quotes and comments. */
export function splitStatements(sql) {
  const statements = [];
  let current = '';
  let index = 0;

  while (index < sql.length) {
    const rest = sql.slice(index);

    // Line comment: skip to end of line.
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end + 1;
      continue;
    }

    // Block comment: skip to the closing marker.
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }

    // Single-quoted string: '' is an escaped quote.
    if (rest.startsWith("'")) {
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === "'" && sql[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === "'") break;
        cursor += 1;
      }
      current += sql.slice(index, cursor + 1);
      index = cursor + 1;
      continue;
    }

    // Dollar-quoted block, e.g. $$ … $$ or $tag$ … $tag$.
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, index + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }

    if (sql[index] === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      index += 1;
      continue;
    }

    current += sql[index];
    index += 1;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** A one-line label for progress output, e.g. "CREATE TABLE users". */
function label(statement) {
  return statement.replace(/\s+/g, ' ').slice(0, 68);
}

async function main() {
  const connectionString = await loadEnv();
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Add it to .env (see .env.example).');
    process.exit(1);
  }

  let host;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    console.error('DATABASE_URL is not a valid connection string.');
    process.exit(1);
  }

  const sql = await readFile(join(root, 'db', 'schema.sql'), 'utf8');
  const statements = splitStatements(sql);

  console.log(`Applying ${statements.length} statements to ${host}\n`);

  for (const [position, statement] of statements.entries()) {
    const response = await fetch(`https://${host}/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Neon-Connection-String': connectionString,
      },
      body: JSON.stringify({ query: statement, params: [] }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(`\n✗ statement ${position + 1} failed\n`);
      console.error(statement);
      console.error(`\n${detail}\n`);
      process.exit(1);
    }

    console.log(`  ${String(position + 1).padStart(3)}. ${label(statement)}`);
  }

  console.log('\n✓ Schema applied.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
