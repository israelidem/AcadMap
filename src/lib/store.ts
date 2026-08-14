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
 * Bumped to 2 when ids became UUIDs and rows gained sync bookkeeping. `load()`
 * brings older snapshots forward; see `migrations.ts`.
 */
const DB_VERSION = 2;

/**
 * Collections that sync to the server, and so must carry `updatedAt` and
 * `deletedAt` on every row.
 *
 * The rest are either device-local (`featureFlags`), owner-only
 * (`announcements`, `activityLogs`, `usageEvents`) or are being replaced by
 * server-side auth (`users`, `credentials`).
 */
export const SYNCED_COLLECTIONS = [
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
    next = migrateSyncMetadata(
      next as unknown as Record<string, unknown>,
      [...SYNCED_COLLECTIONS],
      nowIso(),
    ) as unknown as Database;
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

/** Applies an immutable update, persists it and notifies subscribers. */
export function update(mutator: (current: Database) => Database): void {
  syncFromStorage();
  db = mutator(db);
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

/**
 * Stamps a row so the sync engine can order it against other devices' copies.
 *
 * Applied in these helpers rather than at each call site: every write goes
 * through them, and an unstamped row is invisible to sync — the silent kind of
 * bug where data simply never leaves the device.
 */
function stamp<T>(key: string, row: T, at: string): T {
  if (!SYNCED.has(key)) return row;
  return { ...(row as Record<string, unknown>), updatedAt: at } as T;
}

/** Insert helper for the array collections. */
export function insert<K extends keyof Database>(
  key: K,
  row: Database[K] extends Array<infer R> ? R : never,
): void {
  const at = nowIso();
  update((current) => ({
    ...current,
    [key]: [...(current[key] as unknown as unknown[]), stamp(key as string, row, at)],
  }));
}

/** Patch the first row matching `match` within an array collection. */
export function patchRow<T extends { id: ID }>(
  key: keyof Database,
  id: ID,
  patch: Partial<T>,
): void {
  const at = nowIso();
  update((current) => ({
    ...current,
    [key]: (current[key] as unknown as T[]).map((row) =>
      row.id === id ? stamp(key as string, { ...row, ...patch }, at) : row,
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

    return {
      ...current,
      [key]: rows,
      tombstones: [
        // Re-deleting the same row should not stack up markers.
        ...current.tombstones.filter((t) => !(t.id === id && t.collection === collection)),
        { id, collection, deletedAt: at },
      ],
    };
  });
}


