/**
 * Offline-first sync engine.
 *
 * AcadMap keeps a full working copy of the student's data on the device, so the
 * app stays usable with no connection. The server is the source of truth that
 * lets a phone and a laptop see the same account. This module reconciles the
 * two.
 *
 * The rules it implements, in the order they matter:
 *
 *   1. Changes that do not collide always merge. If the phone added a course and
 *      the laptop recorded a result, the student ends up with both — they are
 *      never asked about work that does not actually conflict.
 *   2. A row edited in both places since the last sync is a conflict, and the
 *      student decides. Silently picking a winner loses academic data the
 *      student typed, which is the one thing this app must not do.
 *   3. Deletes travel as tombstones. A row that is simply missing is
 *      indistinguishable from a row this device has never seen, so deleting
 *      locally must leave a marker or the delete would be undone by the next
 *      pull.
 *
 * Everything here is pure: it takes two row sets and returns what to do. That
 * keeps the tricky reasoning testable and out of the network and storage layers.
 */

import type { ID, Timestamp } from './types.js';

/**
 * The bookkeeping every synced row carries.
 *
 * `updatedAt` is what merging is decided on, so it must be set on every write.
 * `deletedAt` makes a delete a normal update that can be replicated.
 */
export interface SyncMeta {
  id: ID;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
}

export type SyncableRow = SyncMeta & Record<string, unknown>;

/** Which side a conflict was resolved in favour of. */
export type Resolution = 'LOCAL' | 'REMOTE';

/**
 * One row that changed on both devices since the last sync.
 *
 * Both versions are carried so the UI can show the student what differs and
 * name the fields, rather than asking them to choose blind.
 */
export interface Conflict<T extends SyncMeta = SyncableRow> {
  /** Which set of rows this belongs to, e.g. `courses`. */
  collection: string;
  id: ID;
  local: T;
  remote: T;
  /** Fields whose values differ, for display. Never includes `updatedAt`. */
  changedFields: string[];
}

export interface MergeOptions {
  /**
   * When the device last completed a sync. Rows untouched since then cannot
   * have been edited here, which is what makes conflict detection possible
   * without storing a third copy of every row.
   *
   * Null means this device has never synced, so every local row is treated as a
   * local change.
   */
  lastSyncedAt: Timestamp | null;
  collection: string;
}

export interface MergeResult<T extends SyncMeta = SyncableRow> {
  /**
   * The reconciled rows, with conflicts left at their local value so the app
   * keeps working while the student decides.
   */
  merged: T[];
  /** Rows needing a decision. Empty means the sync can complete silently. */
  conflicts: Array<Conflict<T>>;
  /** Rows the server does not have, or has an older copy of. */
  toPush: T[];
}

/** Fields that differ between two versions, ignoring sync bookkeeping. */
export function changedFields<T extends SyncMeta>(local: T, remote: T): string[] {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  keys.delete('updatedAt');

  const differing: string[] = [];
  for (const key of keys) {
    const a = (local as Record<string, unknown>)[key];
    const b = (remote as Record<string, unknown>)[key];
    // Structural comparison: several fields hold arrays or nested objects
    // (grading rules, snapshot payloads) where identity is not equality.
    if (JSON.stringify(a) !== JSON.stringify(b)) differing.push(key);
  }
  return differing.sort();
}

/** True when the row was written after the last completed sync. */
function changedSince(row: SyncMeta, lastSyncedAt: Timestamp | null): boolean {
  if (lastSyncedAt === null) return true;
  return row.updatedAt > lastSyncedAt;
}

/**
 * Reconciles one collection.
 *
 * Rows are matched by id, which is generated client-side, so a row created
 * offline keeps its identity when it reaches the server and cannot be
 * duplicated by a repeated push.
 */
export function mergeCollection<T extends SyncMeta>(
  local: T[],
  remote: T[],
  options: MergeOptions,
): MergeResult<T> {
  const { lastSyncedAt, collection } = options;

  const localById = new Map(local.map((row) => [row.id, row]));
  const remoteById = new Map(remote.map((row) => [row.id, row]));

  const merged: T[] = [];
  const conflicts: Array<Conflict<T>> = [];
  const toPush: T[] = [];

  for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
    const mine = localById.get(id);
    const theirs = remoteById.get(id);

    // Only one side knows this row.
    if (mine && !theirs) {
      merged.push(mine);
      toPush.push(mine);
      continue;
    }
    if (theirs && !mine) {
      // Nothing to decide: either it is new to this device, or this device
      // already synced the delete and the tombstone is what it is.
      merged.push(theirs);
      continue;
    }
    if (!mine || !theirs) continue; // unreachable; satisfies the checker

    // Identical rows are common — most of a sync is rows nobody touched.
    if (changedFields(mine, theirs).length === 0) {
      merged.push(mine.updatedAt >= theirs.updatedAt ? mine : theirs);
      continue;
    }

    const localChanged = changedSince(mine, lastSyncedAt);
    const remoteChanged = changedSince(theirs, lastSyncedAt);

    if (localChanged && remoteChanged) {
      // Both devices edited this row while apart. The student decides; until
      // then the local value stays on screen so the app is not disrupted.
      conflicts.push({
        collection,
        id,
        local: mine,
        remote: theirs,
        changedFields: changedFields(mine, theirs),
      });
      merged.push(mine);
      continue;
    }

    if (localChanged) {
      merged.push(mine);
      toPush.push(mine);
    } else {
      merged.push(theirs);
    }
  }

  return { merged, conflicts, toPush };
}

/**
 * Applies the student's decisions to a merged set.
 *
 * `resolutions` maps a conflict id to the side that wins. Anything left
 * unresolved keeps the local value, matching what the student already sees.
 * Rows resolved in favour of the local copy are re-stamped so they are newer
 * than the remote version and win the next push, rather than reappearing as a
 * conflict for ever.
 */
export function applyResolutions<T extends SyncMeta>(
  merged: T[],
  conflicts: Array<Conflict<T>>,
  resolutions: Record<ID, Resolution>,
  resolvedAt: Timestamp,
): { rows: T[]; toPush: T[] } {
  const byId = new Map(merged.map((row) => [row.id, row]));
  const toPush: T[] = [];

  for (const conflict of conflicts) {
    const choice = resolutions[conflict.id] ?? 'LOCAL';
    if (choice === 'REMOTE') {
      byId.set(conflict.id, conflict.remote);
    } else {
      const winner = { ...conflict.local, updatedAt: resolvedAt };
      byId.set(conflict.id, winner);
      toPush.push(winner);
    }
  }

  return { rows: [...byId.values()], toPush };
}

/**
 * Drops tombstones that every device has certainly seen.
 *
 * Tombstones cannot be deleted immediately or a device that has been offline
 * would resurrect the row. Keeping them for a retention window is the standard
 * trade: a device offline longer than this loses its deletes, not its data.
 */
export function pruneTombstones<T extends { deletedAt?: Timestamp | null }>(
  rows: T[],
  now: Timestamp,
  retentionDays = 60,
): T[] {
  const cutoff = new Date(new Date(now).getTime() - retentionDays * 86_400_000).toISOString();
  return rows.filter((row) => !row.deletedAt || row.deletedAt > cutoff);
}

/** Live rows only — what the app should ever render. */
export function visible<T extends SyncMeta>(rows: T[]): T[] {
  return rows.filter((row) => !row.deletedAt);
}
