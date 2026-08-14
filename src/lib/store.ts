/**
 * AcadMap client data store.
 *
 * The MVP ships a local-first store: everything a student records is kept in
 * `localStorage` so the app is fully usable at zero infrastructure cost. The
 * shape below intentionally mirrors the relational schema in `db/schema.sql`
 * and the REST contract in `api/`, so switching the app to the Neon-backed API
 * is a matter of swapping the persistence adapter, not rewriting features.
 *
 * Note: local data is not encrypted and lives only in the current browser.
 */

import { useSyncExternalStore } from 'react';
import type {
  AcademicEvent,
  AcademicYear,
  AdminActivityLog,
  Announcement,
  AppNotification,
  AvailabilitySlot,
  Course,
  CourseTopic,
  FeatureFlags,
  Feedback,
  Goal,
  GradingSystem,
  ID,
  Preferences,
  Profile,
  Result,
  ShareSnapshot,
  StudySession,
  Task,
  UsageEvent,
  User,
} from '@shared/types';
import { PRESET_GRADING_SYSTEMS } from '@shared/grading';
import { migrateIdsToUuid, migrateSyncMetadata } from './migrations';
import { forgetAllSyncWatermarks } from './watermark';
import { nowIso } from './utils';



export interface Credential {
  userId: ID;
  salt: string;
  hash: string;
  /** Single-use recovery token issued by "forgot password". */
  resetToken: string | null;
  resetExpiresAt: string | null;
}

/**
 * A record that a row was deleted on this device.
 *
 * Deletes have to be replicable: a row that is simply absent looks exactly like
 * a row this device has never seen, so a pull would hand it straight back. The
 * marker is kept in its own collection rather than as a `deletedAt` flag on the
 * row so that every existing read site — dozens of them — keeps seeing only live
 * rows, with no risk of a deleted course reappearing in the UI.
 */
export interface Tombstone {
  id: ID;
  collection: string;
  deletedAt: string;
}

export interface Database {
  version: number;
  sessionUserId: ID | null;
  /** Deletes awaiting replication, and recent ones kept for other devices. */
  tombstones: Tombstone[];
  /**
   * Rows this device has changed and not yet handed to the server, as
   * `collection:id` keys.
   *
   * An explicit queue, because the obvious alternative is wrong. Choosing what to
   * push by comparing timestamps against the last sync looks equivalent and is
   * not: a first sync of a long history is sent in batches, the sync clock moves
   * on after each one, and every row that had not been sent yet then looks
   * already synced. That is what left one account with its dashboard on the server
   * and its academic record stranded on the phone.
   *
   * Entries are removed only once the server has accepted the row, so an
   * interrupted sync resumes rather than loses. Re-sending a row that did arrive
   * is harmless — the server upserts.
   */
  outbox: string[];

  users: User[];
  credentials: Credential[];
  profiles: Profile[];
  preferences: Record<ID, Preferences>;
  gradingSystems: GradingSystem[];
  academicYears: AcademicYear[];
  terms: import('@shared/types').Term[];
  courses: Course[];
  topics: CourseTopic[];
  results: Result[];
  events: AcademicEvent[];
  tasks: Task[];
  availability: AvailabilitySlot[];
  sessions: StudySession[];
  goals: Goal[];
  snapshots: ShareSnapshot[];
  notifications: AppNotification[];
  feedback: Feedback[];
  announcements: Announcement[];
  featureFlags: FeatureFlags;
  activityLogs: AdminActivityLog[];
  usageEvents: UsageEvent[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  notificationsEnabled: false,
  reminderLeadMinutes: 30,
  defaultSessionMinutes: 60,
};

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  gpaCalculatorEnabled: true,
  gpaProjectionEnabled: true,
  plannerEnabled: true,
  goalsEnabled: true,
  streaksEnabled: true,
  sharingEnabled: true,
  notificationsEnabled: true,
};

const STORAGE_KEY = 'acadmap.db.v1';

/**
 * 2 when ids became UUIDs and rows gained sync bookkeeping; 3 when writes began
 * being stamped centrally, which is also when rows already saved without a stamp
 * had to be rescued; 4 when pushes moved to an explicit outbox, which every
 * existing row is enqueued into so a half-synced account finishes uploading.
 * `load()` brings older snapshots forward; see `migrations.ts`.
 */
const DB_VERSION = 4;

/**
 * Collections that sync to the server, and so must carry `updatedAt` and
 * `deletedAt` on every row.
 *
 * The rest are either device-local (`featureFlags`), owner-only
 * (`announcements`, `activityLogs`, `usageEvents`) or are being replaced by
 * server-side auth (`users`, `credentials`).
 */
export const SYNCED_COLLECTIONS = [
  // The profile says whether academic setup is finished. Without it, a second
  // device sends the student back through onboarding and then shows them an
  // empty dashboard, even though the account is complete.
  'profiles',
  'gradingSystems',
  'academicYears',
  'terms',
  'courses',
  'topics',
  'results',
  'events',
  'tasks',
  'availability',
  'sessions',
  'goals',
  'snapshots',
  'notifications',
  'feedback',
] as const;


function emptyDatabase(): Database {
  return {
    version: DB_VERSION,
    sessionUserId: null,
    tombstones: [],
    outbox: [],
    users: [],


    credentials: [],
    profiles: [],
    preferences: {},
    gradingSystems: [...PRESET_GRADING_SYSTEMS],
    academicYears: [],
    terms: [],
    courses: [],
    topics: [],
    results: [],
    events: [],
    tasks: [],
    availability: [],
    sessions: [],
    goals: [],
    snapshots: [],
    notifications: [],
    feedback: [],
    announcements: [],
    featureFlags: { ...DEFAULT_FEATURE_FLAGS },
    activityLogs: [],
    usageEvents: [],
  };
}

/**
 * Turns a stored snapshot into a usable database, migrating it if it is old.
 *
 * Shared by the initial load and by cross-tab reads so a snapshot can never
 * reach the app un-migrated, whichever path it arrived by.
 */
function hydrate(parsed: Partial<Database>): Database {
  // Merge over defaults so older payloads gain new collections safely.
  let next = { ...emptyDatabase(), ...parsed };

  if ((parsed.version ?? 1) < 2) {
    // Ids became UUIDs and rows gained sync bookkeeping. Both rewrites are
    // idempotent, but they walk the whole snapshot, so they run only when the
    // stored version says they are needed.
    next = migrateIdsToUuid(next);
  }

  if ((parsed.version ?? 1) < 3) {
    /*
     * Rescues rows that were saved before writes were stamped centrally.
     *
     * Until then the action layer wrote rows with no `updatedAt` at all. The
     * sync engine reads an unstamped row as dated 1970 and only offers rows
     * newer than the last completed sync, so every course, result and session a
     * student recorded after their first sync was silently unsendable. Stamping
     * them now and forgetting the watermark makes the whole account look new,
     * which is exactly right: as far as the server is concerned, it is.
     */
    next.profiles = next.profiles.map((profile) => ({
      ...profile,
      // Profiles predate having an id of their own; sync addresses rows by id.
      id: profile.id ?? profile.userId,
    }));

    next = migrateSyncMetadata(
      next as unknown as Record<string, unknown>,
      [...SYNCED_COLLECTIONS],
      nowIso(),
    ) as unknown as Database;

    forgetAllSyncWatermarks();
  }

  if ((parsed.version ?? 1) < 4) {
    /*
     * Enqueues everything this device holds, because some of it never arrived.
     *
     * Pushes used to be chosen by timestamp: rows newer than the last completed
     * sync. A long history goes up in batches, and the sync clock moved on after
     * each batch, so from the second batch onwards the rows still waiting looked
     * as though they had already been sent. Accounts came out half-uploaded —
     * typically the dashboard's recent rows, with older records left behind.
     *
     * Re-queuing the lot is the repair. The server upserts, so rows that did
     * arrive are simply written again with the same values.
     */
    next.outbox = withEverythingQueued(next);
  }

  return { ...next, version: DB_VERSION };

}

function load(): Database {
  if (typeof localStorage === 'undefined') return emptyDatabase();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDatabase();
    return hydrate(JSON.parse(raw) as Partial<Database>);
  } catch {
    return emptyDatabase();
  }
}


let db: Database = load();
const listeners = new Set<() => void>();

/**
 * The exact JSON this tab last wrote. Used to tell "someone else changed
 * storage" apart from "this is my own write echoing back".
 */
let lastWritten: string | null = null;

function notify(): void {
  listeners.forEach((listener) => listener());
}

function persist(): void {
  try {
    const raw = JSON.stringify(db);
    localStorage.setItem(STORAGE_KEY, raw);
    lastWritten = raw;
  } catch {
    // Storage full or unavailable — keep the in-memory state usable.
  }
}

/**
 * Pulls in another tab's writes before we build our next state.
 *
 * Two tabs both holding an in-memory copy would otherwise clobber each other:
 * the second one to save would write a snapshot that never saw the first one's
 * changes. Comparing the stored JSON against our own last write is a string
 * compare in the common case, and only re-parses when something actually
 * changed elsewhere.
 *
 * @returns true when the in-memory database was replaced.
 */
function syncFromStorage(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === lastWritten) return false;
    // Goes through `hydrate` as well: an old tab can write a v1 snapshot at any
    // moment, and it must not reach the app un-migrated.
    db = hydrate(JSON.parse(raw) as Partial<Database>);

    lastWritten = raw;
    return true;
  } catch {
    return false;
  }
}

// A sign-in, a completed session or a deleted course in one tab should show up
// in the others rather than being silently overwritten later.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    if (syncFromStorage()) notify();
  });
}

export function getDatabase(): Database {
  return db;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Gives every row a write changed a fresh `updatedAt`.
 *
 * This is what makes a write visible to sync, and it is done here rather than at
 * each call site because it was done at call sites and they did not do it: the
 * action layer writes through `update()` directly, so rows were saved with no
 * stamp, the sync engine read them as dated 1970, and nothing a student typed
 * after their first sync was ever uploaded. One choke point cannot be forgotten.
 *
 * A row is left alone when it already carries a stamp the mutator chose: rows
 * arriving from the server are authored by another device and re-stamping them
 * would send them straight back as if they were local edits.
 *
 *   * same object as before  → nothing changed, leave it
 *   * new row with a stamp   → came from the server, leave it
 *   * changed, stamp is the  → a local edit, stamp it now
 *     one it already had
 */
function stampWrites(previous: Database, next: Database, at: string): Database {
  let result = next;
  const queued: string[] = [];

  for (const key of SYNCED_COLLECTIONS) {
    const before = previous[key] as unknown as Array<Record<string, unknown>>;
    const after = next[key] as unknown as Array<Record<string, unknown>>;
    // Untouched collections are the common case: one reference compare each.
    if (before === after) continue;

    const byId = new Map(before.map((row) => [row.id, row]));
    let changed = false;

    const stamped = after.map((row) => {
      const old = byId.get(row.id);
      if (old === row) return row;
      if (!old && typeof row.updatedAt === 'string') return row;

      // Everything below is a local write, so it also joins the queue of rows
      // owed to the server. Stamping alone was not enough: the stamp says when
      // the row changed, the queue says it has not been sent.
      queued.push(outboxKey(key, String(row.id)));
      if (!old) return { ...row, updatedAt: at };
      if (old.updatedAt !== row.updatedAt) return row;
      changed = true;
      return { ...row, updatedAt: at };
    });

    // Rebuilt only when a stamp was actually added, so subscribers are not woken
    // by a new array holding all the same rows.
    if (changed || stamped.some((row, index) => row !== after[index])) {
      result = { ...result, [key]: stamped };
    }
  }

  if (queued.length > 0) {
    const known = new Set(result.outbox);
    const fresh = queued.filter((entry) => !known.has(entry));
    if (fresh.length > 0) result = { ...result, outbox: [...result.outbox, ...fresh] };
  }

  return result;
}

/**
 * The moment to stamp the current write with, always after the previous one.
 *
 * A plain clock reading is not enough: two writes can land in the same
 * millisecond, and then the second one is indistinguishable from the first. That
 * matters because "has this row changed since the copy the server took?" is
 * answered by comparing stamps — an edit sharing a stamp with the version that
 * was just uploaded would be treated as already sent and never go.
 */
let lastStamp = '';

function nextStamp(): string {
  const now = nowIso();
  if (now > lastStamp) {
    lastStamp = now;
    return now;
  }
  lastStamp = new Date(new Date(lastStamp).getTime() + 1).toISOString();
  return lastStamp;
}

/** Applies an immutable update, persists it and notifies subscribers. */
export function update(mutator: (current: Database) => Database): void {
  syncFromStorage();
  const previous = db;
  db = stampWrites(previous, mutator(previous), nextStamp());
  persist();
  notify();
}



export function resetDatabase(): void {
  update(() => emptyDatabase());
}

/**
 * Subscribe a component to a slice of the database.
 *
 * The snapshot handed to `useSyncExternalStore` is the database object itself,
 * never the selected slice. Selectors here build new objects and arrays
 * (`{ courses: […] }`), so returning one as the snapshot would look like a fresh
 * value on every call and re-render forever — a warning in development and
 * "Maximum update depth exceeded" in a production build.
 *
 * Because `update()` replaces `db` immutably, this reference changes exactly when
 * the data does. The selector then runs during render, which also keeps results
 * correct when only its inputs change (a different `userId`, say) and the
 * database has not.
 */
export function useDb<T>(selector: (current: Database) => T): T {
  const current = useSyncExternalStore(subscribe, getDatabase, getDatabase);
  return selector(current);
}

export function replaceCollection<K extends keyof Database>(
  key: K,
  value: Database[K],
): void {
  update((current) => ({ ...current, [key]: value }));
}

const SYNCED = new Set<string>(SYNCED_COLLECTIONS);

/** How a row is named in the outbox. */
export function outboxKey(collection: string, id: ID): string {
  return `${collection}:${id}`;
}

/** Every row and delete this device holds, queued, with no duplicates. */
function withEverythingQueued(current: Database): string[] {
  const queued = new Set(current.outbox);
  for (const collection of SYNCED_COLLECTIONS) {
    for (const row of current[collection] as unknown as Array<{ id?: ID }>) {
      if (row.id) queued.add(outboxKey(collection, row.id));
    }
  }
  for (const tombstone of current.tombstones) {
    queued.add(outboxKey(tombstone.collection, tombstone.id));
  }
  return [...queued];
}

/**
 * Queues everything, for when the whole account has to be uploaded again.
 *
 * Used after a local-only account is claimed and its rows are moved onto the id
 * the server issued. Every row is new as far as the server is concerned, and the
 * queue entries written before the move name ids that no longer exist.
 */
export function enqueueAllRows(): void {
  update((current) => ({ ...current, outbox: withEverythingQueued(current) }));
}


/** The version of a queued row as it stands now: its stamp, or a delete's time. */
function currentStamp(current: Database, entry: string): string | null {
  const split = entry.indexOf(':');
  const collection = split === -1 ? entry : entry.slice(0, split);
  const id = entry.slice(split + 1);

  const rows = current[collection as keyof Database] as unknown;
  if (Array.isArray(rows)) {
    const row = (rows as Array<Record<string, unknown>>).find((item) => item.id === id);
    if (row) return typeof row.updatedAt === 'string' ? row.updatedAt : null;
  }

  const tombstone = current.tombstones.find(
    (t) => t.id === id && t.collection === collection,
  );
  return tombstone?.deletedAt ?? null;
}

/**
 * Forgets queue entries the server has accepted, and only those.
 *
 * Each entry is cleared against the version that was actually sent. A row edited
 * while the request was in flight now carries a different stamp, and its entry
 * stays: the server has the older copy, so the queue is still the only record
 * that the newer one is owed. Clearing by name alone loses that edit silently —
 * the row looks synced, and its stamp is already older than the sync that missed
 * it, so nothing ever picks it up again.
 *
 * A `null` stamp means there is nothing left to send for that entry (the row is
 * gone with no tombstone, or the id predates UUIDs) and it goes unconditionally.
 */
export function clearOutboxEntries(
  sent: ReadonlyArray<{ entry: string; stamp: string | null }>,
): void {
  if (sent.length === 0) return;
  const expected = new Map(sent.map((item) => [item.entry, item.stamp] as const));

  update((current) => ({
    ...current,
    outbox: current.outbox.filter((entry) => {
      if (!expected.has(entry)) return true;
      const stamp = expected.get(entry) ?? null;
      if (stamp === null) return false;
      return currentStamp(current, entry) !== stamp;
    }),
  }));
}


/**
 * Insert helper for the array collections.
 *
 * Stamping and queueing are left to `update()`, which sees every write including
 * the ones that bypass these helpers.
 */
export function insert<K extends keyof Database>(
  key: K,
  row: Database[K] extends Array<infer R> ? R : never,
): void {
  update((current) => ({
    ...current,
    [key]: [...(current[key] as unknown as unknown[]), row],
  }));
}

/** Patch the first row matching `match` within an array collection. */
export function patchRow<T extends { id: ID }>(
  key: keyof Database,
  id: ID,
  patch: Partial<T>,
): void {
  update((current) => ({
    ...current,
    [key]: (current[key] as unknown as T[]).map((row) =>
      row.id === id ? { ...row, ...patch } : row,
    ),
  }));
}

/**
 * Deletes a row and, for synced collections, leaves a tombstone behind.
 *
 * The row really is removed from its collection, so every read site keeps
 * working unchanged; the tombstone is what travels to the server and stops
 * another device handing the row back on the next pull.
 */
export function removeRow(key: keyof Database, id: ID): void {
  const at = nowIso();
  const collection = key as string;

  update((current) => {
    const rows = (current[key] as unknown as { id: ID }[]).filter((row) => row.id !== id);
    if (!SYNCED.has(collection)) return { ...current, [key]: rows };

    const entry = outboxKey(collection, id);

    return {
      ...current,
      [key]: rows,
      tombstones: [
        // Re-deleting the same row should not stack up markers.
        ...current.tombstones.filter((t) => !(t.id === id && t.collection === collection)),
        { id, collection, deletedAt: at },
      ],
      // The delete is owed to the server too, and for the same reason: without a
      // queue entry it would only be offered while it looked newer than the last
      // sync, which a batched first upload quietly makes false.
      outbox: current.outbox.includes(entry) ? current.outbox : [...current.outbox, entry],
    };

  });
}


