/**
 * Empties the Neon database in DATABASE_URL, then re-applies db/schema.sql.
 *
 *   npm run db:reset -- --yes
 *
 * DESTRUCTIVE. Every table, every row, every account. There is no undo and Neon's
 * free tier keeps no backup you can restore from here. It exists because AcadMap's
 * accounts predate server-side auth: they were minted in browsers, some never
 * reached Postgres, and the ones that did are keyed on ids Better Auth will not
 * issue. With a handful of early users, starting clean is honest and cheap, where
 * migrating half-formed accounts is neither.
 *
 * Two guards, both deliberate:
 *   * `--yes` is required. Running the script by itself only prints what it would
 *     do, so a mistyped command cannot cost you the database.
 *   * The host is printed before anything happens. Reading it is the one check
 *     that catches the mistake that actually matters — pointing a .env at
 *     production while meaning to reset a branch.
 *
 * `DROP SCHEMA public CASCADE` is used rather than a list of DROP TABLEs: a list
 * has to be maintained, and the one table someone forgets to add is the one whose
 * stale rows resurface later. The schema is recreated immediately, so the database
 * is left in the state a fresh Neon project would be in.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { splitStatements } from './db-push.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env reader — mirrors db-push.mjs so neither script needs a dependency. */
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

async function run(connectionString, host, statement) {
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
    throw new Error(`${statement.replace(/\s+/g, ' ').slice(0, 68)}\n\n${detail}`);
  }
}

async function main() {
  const connectionString = await loadEnv();
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Add it to .env (see .env.example).');
    process.exit(1);
  }

  let host;
  let database;
  try {
    const url = new URL(connectionString);
    host = url.hostname;
    database = url.pathname.replace(/^\//, '') || '(default)';
  } catch {
    console.error('DATABASE_URL is not a valid connection string.');
    process.exit(1);
  }

  const confirmed = process.argv.includes('--yes');

  console.log('This will PERMANENTLY DELETE all data in:');
  console.log(`  host:     ${host}`);
  console.log(`  database: ${database}\n`);

  if (!confirmed) {
    console.log('Nothing was changed. Re-run with --yes to go ahead:\n');
    console.log('  npm run db:reset -- --yes\n');
    return;
  }

  console.log('Dropping schema public …');
  await run(connectionString, host, 'DROP SCHEMA public CASCADE');
  await run(connectionString, host, 'CREATE SCHEMA public');

  const sql = await readFile(join(root, 'db', 'schema.sql'), 'utf8');
  const statements = splitStatements(sql);
  console.log(`Applying ${statements.length} statements from db/schema.sql …`);
  for (const statement of statements) {
    await run(connectionString, host, statement);
  }

  console.log('\n✓ Database reset. Every account is gone; sign up again to create one.');
}

main().catch((error) => {
  console.error(`\n✗ reset failed\n\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
