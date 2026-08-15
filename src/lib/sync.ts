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
 *   1. Take this device's changes from the outbox — the rows and deletes the
 *      store queued as they were written, oldest first.
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
 *     leaves the local database untouched, the watermark unmoved and the outbox
 *     intact, so the next attempt simply tries again.

 */

import {
  mergeCollection,
  pruneTombstones,
  type Conflict,
  type SyncableRow,
} from '@shared/sync';
import { SYNC_COLLECTIONS } from '@shared/schemas';
import { ApiError, api } from './api';
import { lastSyncedAt, setLastSyncedAt } from './watermark';

import {
  SYNCED_COLLECTIONS,
  clearOutboxEntries,
  getDatabase,
  outboxKey,
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

// The watermark itself lives in `watermark.ts`: the store's migrations need to
// clear it, and the store cannot import this module.
export { forgetSyncState, lastSyncedAt } from './watermark';


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
      // of when the edit happened. Stamps are normalised here as well, because
      // merging compares them as strings and two formats do not order together.
      updatedAt: isoOrNull(row.updatedAt) ?? new Date(0).toISOString(),
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

/**
 * A timestamp in the one format both sides agree on, or null if it is not a
 * timestamp at all.
 *
 * Everything that arrives from the server passes through here. Postgres renders
 * a timestamptz as `2026-08-14 17:12:00+00`, and a stored row carrying that
 * string is rejected the moment it is pushed back, because the API asks for ISO.
 * That is how a device could pull an account and then fail every subsequent sync
 * with "Validation failed" — the server now formats its output, and this repairs
 * the rows that were saved before it did.
 */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function fromWire(row: WireRow): SyncableRow {
  return {
    ...row.data,
    id: row.id,
    updatedAt: isoOrNull(row.updatedAt) ?? new Date(0).toISOString(),
    deletedAt: isoOrNull(row.deletedAt),
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

/**
 * What this device owes the server, oldest first.
 *
 * Read from the outbox rather than worked out from timestamps. The timestamp
 * version had a hole that cost real data: a long history is sent in batches, the
 * sync clock advances after each one, and every row still waiting then looked
 * already sent — accounts arrived with their recent rows and nothing older.
 *
 * Every entry taken is returned with the version of it that went, so the queue
 * can be cleared against what the server actually received. Entries with nothing
 * left to send — a row gone without a tombstone, an id from before ids were
 * UUIDs — carry a null version and are simply dropped, so the queue cannot grow
 * for ever. Entries belonging to another account on this device are left alone,
 * to be sent when that student signs in.
 */

/** A queue entry and the version of it that went to the server. */
interface SentEntry {
  entry: string;
  stamp: string | null;
}

function drainOutbox(
  db: Database,
  userId: string,
): { rows: WireRow[]; sent: SentEntry[]; more: boolean } {
  const syncable = new Set<string>(SYNC_COLLECTIONS);
  const tombstones = new Map(
    db.tombstones.map((t) => [outboxKey(t.collection, t.id), t] as const),
  );

  const rows = new Map<string, Record<string, unknown>>();
  for (const collection of SYNCED_COLLECTIONS) {
    for (const row of db[collection] as unknown as Array<Record<string, unknown>>) {
      rows.set(outboxKey(collection, String(row.id)), row);
    }
  }

  const wire: WireRow[] = [];
  const sent: SentEntry[] = [];
  let more = false;

  for (const entry of db.outbox) {
    if (wire.length >= BATCH) {
      more = true;
      break;
    }

    const split = entry.indexOf(':');
    const collection = entry.slice(0, split);
    const id = entry.slice(split + 1);

    /*
     * A row id is either a UUID this app generated or the account id itself: the
     * profile row is keyed by it, and Better Auth's ids are its own opaque
     * strings, not UUIDs. Testing for a UUID alone dropped the profile from every
     * push — quietly, because an entry with nothing to send is simply cleared —
     * so academic data reached the server while the profile and the "setup
     * finished" flag never left the device, and a second device found no profile
     * and offered onboarding again.
     */
    if (!syncable.has(collection) || !(UUID.test(id) || id === userId)) {
      sent.push({ entry, stamp: null });
      continue;
    }

    const tombstone = tombstones.get(entry);
    if (tombstone) {
      // A delete whose time cannot be read is unsendable; dropping the entry is
      // better than a payload the server refuses, which would block the queue.
      if (!isoOrNull(tombstone.deletedAt)) {
        sent.push({ entry, stamp: null });
        continue;
      }
      wire.push(tombstoneToWire(tombstone));
      sent.push({ entry, stamp: tombstone.deletedAt });
      continue;
    }

    const row = rows.get(entry);
    if (!row) {
      sent.push({ entry, stamp: null });
      continue;
    }
    // Another student's row on a shared device: not ours to send, not ours to
    // discard either.
    if ('userId' in row && row.userId !== userId) continue;

    // An unreadable stamp is treated as ancient rather than sent as-is: the
    // server would reject the whole batch, so one bad row would stop the account
    // syncing at all.
    const stamp = isoOrNull(row.updatedAt) ?? new Date(0).toISOString();


    wire.push(toWire(collection, { ...row, id, updatedAt: stamp, deletedAt: null } as SyncableRow));
    // The stamp is recorded, not just the name: an edit landing while this
    // request is in flight must keep the entry alive.
    sent.push({ entry, stamp });
  }

  return { rows: wire, sent, more };
}

/** One request/response. Returns true when the account is fully caught up. */
async function exchange(userId: string): Promise<boolean> {
  const db = getDatabase();
  const since = lastSyncedAt(userId);

  const outgoing = drainOutbox(db, userId);
  const response = await api.sync({ since, rows: outgoing.rows });

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

      const deletedAt = isoOrNull(row.deletedAt) ?? new Date().toISOString();

      const local = mineById.get(row.id);
      if (local && local.updatedAt > deletedAt) {
        // Edited here after the delete elsewhere. Keep it and push it back.
        survivors.add(row.id);
        continue;
      }

      newTombstones.push({ id: row.id, collection, deletedAt });

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

  // Only now that the server has them: an interrupted sync must resume, not lose.
  clearOutboxEntries(outgoing.sent);


  setLastSyncedAt(userId, response.syncedAt);
  setState({ conflicts });

  // More to pull, or more of our own still queued.
  return !response.hasMore && !outgoing.more;

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
