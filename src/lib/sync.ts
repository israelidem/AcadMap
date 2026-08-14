/**
 * The client half of cross-device sync.
 *
 * The app stays local-first: every screen reads and writes localStorage and does
 * not wait for the network. This module is the background process that carries
 * those writes to the account and brings back what other devices did, so signing
 * in on a laptop shows the work done on a phone.
 *
 * One exchange, in order:
 *
 *   1. Collect this device's changes — rows written since the last completed
 *      sync, plus deletes recorded as tombstones.
 *   2. POST them and receive everything the account changed since then.
 *   3. Reconcile per collection with `mergeCollection`, the same rules the server
 *      applies, and write the result back in a single store update.
 *
 * Deliberate choices:
 *
 *   * A delete is a tombstone, not an omission. A device that has been offline
 *     for a week cannot tell "deleted" from "never seen" any other way.
 *   * A remote delete loses to a newer local edit. Someone actively working on a
 *     row should not have it vanish under them; the row is pushed back instead.
 *   * Conflicts are never resolved silently. The local value stays on screen and
 *     the row is reported, because guessing which copy of a graded result is
 *     right is not the app's decision to make.
 *   * Failure is normal, not exceptional. Offline, a rate limit or a lost session
 *     leaves the local database untouched and the watermark unmoved, so the next
 *     attempt simply tries again.
 */

import {
  mergeCollection,
  pruneTombstones,
  type Conflict,
  type SyncableRow,
} from '@shared/sync';
import { SYNC_COLLECTIONS } from '@shared/schemas';
import { ApiError, api } from './api';
import {
  SYNCED_COLLECTIONS,
  getDatabase,
  update,
  type Database,
  type Tombstone,
} from './store';

type SyncedCollection = (typeof SYNCED_COLLECTIONS)[number];

/** Shape rows arrive in and leave in. */
export interface WireRow {
  collection: string;
  id: string;
  data: Record<string, unknown>;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SyncState {
  /** True while an exchange is in flight, for a quiet activity indicator. */
  running: boolean;
  lastSyncedAt: string | null;
  /** Set when the last attempt failed, in words a student can act on. */
  error: string | null;
  conflicts: Array<Conflict<SyncableRow>>;
}

/*
 * The watermark lives outside the database snapshot: it is device-local
 * bookkeeping, not account data, and must not travel to another device where it
 * would claim rows had already been seen.
 */
const WATERMARK_KEY = 'acadmap.sync.lastSyncedAt';

function watermarkKey(userId: string): string {
  return `${WATERMARK_KEY}.${userId}`;
}

export function lastSyncedAt(userId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(watermarkKey(userId));
}

function setLastSyncedAt(userId: string, at: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(watermarkKey(userId), at);
}

/** Clears the watermark so the next sync re-reads the whole account. */
export function forgetSyncState(userId: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(watermarkKey(userId));
}

/* ------------------------------ observable state ------------------------- */

let state: SyncState = { running: false, lastSyncedAt: null, error: null, conflicts: [] };
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* --------------------------------- helpers -------------------------------- */

/** Rows of one collection belonging to this user, typed for merging. */
function localRows(db: Database, collection: SyncedCollection, userId: string): SyncableRow[] {
  const rows = db[collection] as unknown as Array<Record<string, unknown>>;
  return rows
    .filter((row) => !('userId' in row) || row.userId === userId)
    .map((row) => ({
      ...row,
      id: String(row.id),
      // Rows written before sync existed have no stamp. Treating them as ancient
      // means the server's copy wins, which is right: this device has no evidence
      // of when the edit happened.
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date(0).toISOString(),
      deletedAt: null,
    })) as SyncableRow[];
}

function toWire(collection: string, row: SyncableRow): WireRow {
  const { id, updatedAt, deletedAt, ...data } = row as SyncableRow & Record<string, unknown>;
  return {
    collection,
    id: String(id),
    data: data as Record<string, unknown>,
    updatedAt: String(updatedAt),
    deletedAt: (deletedAt as string | null) ?? null,
  };
}

/** A recorded delete, in the same wire shape as a live row. */
function tombstoneToWire(tombstone: Tombstone): WireRow {
  return {
    collection: tombstone.collection,
    id: tombstone.id,
    data: {},
    updatedAt: tombstone.deletedAt,
    deletedAt: tombstone.deletedAt,
  };
}

function fromWire(row: WireRow): SyncableRow {
  return {
    ...row.data,
    id: row.id,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  } as SyncableRow;
}

/**
 * Only ids the server will accept. A row created before ids became UUIDs would
 * be rejected by the whole batch, so it is left behind rather than blocking
 * every other row; the migration in `migrations.ts` is what rescues it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rows per request. Comfortably under the server's cap of 500. */
const BATCH = 400;

/* ---------------------------------- the loop ------------------------------ */

let inFlight: Promise<void> | null = null;

/**
 * Runs one full exchange, following pagination until the account is caught up.
 *
 * Concurrent callers share the in-flight run: the interval, the reconnect
 * listener and a manual "sync now" can all fire at once, and two overlapping
 * exchanges would push the same rows twice.
 */
export function syncNow(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<void> {
  const userId = getDatabase().sessionUserId;
  if (!userId) return;

  setState({ running: true, error: null });

  try {
    let guard = 0;
    // Bounded so a server that always reports more cannot spin for ever.
    while (guard < 20) {
      guard += 1;
      const done = await exchange(userId);
      if (done) break;
    }
    setState({ running: false, lastSyncedAt: lastSyncedAt(userId), error: null });
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.isOffline
          ? null // Offline is not a failure worth showing; it will retry.
          : error.status === 401
            ? // Signed in on this device but not with the server: the account was
              // created here before AcadMap kept accounts, so there is no server
              // session to sync with and no way to make one without the password.
              // Saying "unauthorised" would be useless; this says what to do.
              'This device is signed in, but the account has not been set up on ' +
              'AcadMap yet, so nothing can sync. Sign out and sign in again with ' +
              'the same details to finish setting it up — your work stays where it is.'
            : error.message
        : 'Sync could not finish. It will try again shortly.';
    setState({ running: false, error: message });
  }

}

/** One request/response. Returns true when the account is fully caught up. */
async function exchange(userId: string): Promise<boolean> {
  const db = getDatabase();
  const since = lastSyncedAt(userId);

  /* ---- what this device has to offer ---- */

  const pending: WireRow[] = [];

  for (const collection of SYNCED_COLLECTIONS) {
    for (const row of localRows(db, collection, userId)) {
      if (!UUID.test(row.id)) continue;
      if (since !== null && row.updatedAt <= since) continue;
      pending.push(toWire(collection, row));
    }
  }

  const syncable = new Set<string>(SYNC_COLLECTIONS);
  for (const tombstone of db.tombstones) {
    if (!syncable.has(tombstone.collection)) continue;
    if (!UUID.test(tombstone.id)) continue;
    if (since !== null && tombstone.deletedAt <= since) continue;
    pending.push(tombstoneToWire(tombstone));
  }

  const batch = pending.slice(0, BATCH);
  const response = await api.sync({ since, rows: batch });

  /* ---- reconcile ---- */

  const remoteByCollection = new Map<string, WireRow[]>();
  for (const row of response.rows) {
    const list = remoteByCollection.get(row.collection);
    if (list) list.push(row);
    else remoteByCollection.set(row.collection, [row]);
  }

  const conflicts: Array<Conflict<SyncableRow>> = [];
  const nextCollections: Partial<Record<SyncedCollection, unknown[]>> = {};
  const newTombstones: Tombstone[] = [];

  for (const collection of SYNCED_COLLECTIONS) {
    const remote = remoteByCollection.get(collection) ?? [];
    if (remote.length === 0) continue;

    const mine = localRows(db, collection, userId);
    const mineById = new Map(mine.map((row) => [row.id, row]));

    /*
     * Deletes are separated out before merging. `mergeCollection` compares field
     * values, and an empty payload would look like every field being cleared.
     */
    const remoteLive: SyncableRow[] = [];
    const survivors = new Set<string>();

    for (const row of remote) {
      if (!row.deletedAt) {
        remoteLive.push(fromWire(row));
        continue;
      }

      const local = mineById.get(row.id);
      if (local && local.updatedAt > row.deletedAt) {
        // Edited here after the delete elsewhere. Keep it and push it back.
        survivors.add(row.id);
        continue;
      }

      newTombstones.push({
        id: row.id,
        collection,
        deletedAt: row.deletedAt,
      });
    }

    const deleted = new Set(
      remote.filter((row) => row.deletedAt && !survivors.has(row.id)).map((row) => row.id),
    );

    const result = mergeCollection(
      mine.filter((row) => !deleted.has(row.id)),
      remoteLive,
      { lastSyncedAt: since, collection },
    );

    conflicts.push(...result.conflicts);
    nextCollections[collection] = result.merged;
  }

  /* ---- one write, so no screen sees a half-merged account ---- */

  if (Object.keys(nextCollections).length > 0 || newTombstones.length > 0) {
    update((current) => {
      const next: Database = { ...current };

      for (const [collection, rows] of Object.entries(nextCollections)) {
        const key = collection as SyncedCollection;
        const others = (current[key] as unknown as Array<Record<string, unknown>>).filter(
          (row) => 'userId' in row && row.userId !== userId,
        );
        (next[key] as unknown) = [...others, ...(rows as unknown[])];
      }

      if (newTombstones.length > 0) {
        const known = new Set(current.tombstones.map((t) => `${t.collection}:${t.id}`));
        next.tombstones = [
          ...current.tombstones,
          ...newTombstones.filter((t) => !known.has(`${t.collection}:${t.id}`)),
        ];
      }

      // Deletes accepted by every device eventually stop being news.
      next.tombstones = pruneTombstones(next.tombstones, new Date().toISOString());

      return next;
    });
  }

  setLastSyncedAt(userId, response.syncedAt);
  setState({ conflicts });

  // More to pull, or more of our own still queued.
  return !response.hasMore && pending.length <= BATCH;
}

/* -------------------------------- scheduling ------------------------------ */

const INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let stopListening: (() => void) | null = null;

/**
 * Starts syncing in the background and returns a stop function.
 *
 * Beyond the interval, the moments that matter are returning to the app and
 * regaining a connection — that is when a student is most likely to have stale
 * data in front of them, or a queue of offline edits to deliver.
 */
export function startSync(): () => void {
  stopSync();

  void syncNow();
  timer = setInterval(() => void syncNow(), INTERVAL_MS);

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void syncNow();
  };
  const onOnline = (): void => void syncNow();

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);

  stopListening = () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  };

  return stopSync;
}

export function stopSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  stopListening?.();
  stopListening = null;
}
