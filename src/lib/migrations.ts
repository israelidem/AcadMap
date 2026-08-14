/**
 * Stored-data migrations.
 *
 * The local database is a JSON snapshot in `localStorage` that can have been
 * written by any earlier build of the app, so it has to be brought forward
 * before the app reads it. Migrations are pure functions over the parsed
 * snapshot: given last version's shape, return this version's.
 */

import { isUuid, uid } from './utils';

/**
 * Ids minted before the switch to UUIDs, e.g. `crs_9f2a1c`.
 *
 * Deliberately narrow: an underscore-separated prefix and hex-ish tail. The
 * built-in grading systems use `preset-5` and `preset-4`, which do not match and
 * must not be rewritten — they are shared constants, not per-user rows.
 */
const LEGACY_ID = /^[a-z]{2,6}_[0-9a-z]{4,}$/;

/**
 * Rewrites legacy prefixed ids to UUIDs, references included.
 *
 * Every primary key in Postgres is a `UUID`, so rows created by an older build
 * could never be synced. Renaming an id means finding every field that points at
 * it — `courseId`, `termId`, `replacesResultId`, the keys of the `preferences`
 * map, `sessionUserId` — and a per-field allow-list would silently miss one and
 * break a student's data.
 *
 * So instead of reasoning about which fields hold ids, this replaces *every*
 * string in the snapshot that looks like a legacy id, keying on the value. Any
 * two occurrences of the same old id therefore get the same new UUID, which is
 * exactly the property referential integrity needs. The theoretical cost is
 * rewriting a free-text field that happens to look like an id; the benefit is
 * that no reference can be missed.
 */
export function migrateIdsToUuid<T>(snapshot: T): T {
  const map = new Map<string, string>();

  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      if (LEGACY_ID.test(value) && !isUuid(value) && !map.has(value)) {
        map.set(value, uid());
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        // Object keys carry ids too: `preferences` is keyed by user id.
        collect(key);
        collect(nested);
      }
    }
  };

  collect(snapshot);
  if (map.size === 0) return snapshot;

  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') return map.get(value) ?? value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value)) {
        out[map.get(key) ?? key] = rewrite(nested);
      }
      return out;
    }
    return value;
  };

  return rewrite(snapshot) as T;
}

/**
 * Gives every synced row the bookkeeping the sync engine needs.
 *
 * Rows written before sync existed have no `updatedAt`, and a missing timestamp
 * would make them look either infinitely old or brand new depending on the
 * comparison. Stamping them once, with a time in the past, means they are
 * treated as already-synced baseline data rather than as local edits that must
 * win every conflict.
 */
export function migrateSyncMetadata<T extends Record<string, unknown>>(
  snapshot: T,
  collections: string[],
  stampedAt: string,
): T {
  const next = { ...snapshot } as Record<string, unknown>;

  for (const key of collections) {
    const rows = next[key];
    if (!Array.isArray(rows)) continue;

    next[key] = rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const record = row as Record<string, unknown>;
      if (typeof record.updatedAt === 'string' && 'deletedAt' in record) return row;
      return {
        ...record,
        updatedAt:
          typeof record.updatedAt === 'string'
            ? record.updatedAt
            : // `createdAt` is the best evidence available of when this row was
              // last meaningful; otherwise fall back to the migration time.
              typeof record.createdAt === 'string'
              ? record.createdAt
              : stampedAt,
        deletedAt: record.deletedAt ?? null,
      };
    });
  }

  return next as T;
}
