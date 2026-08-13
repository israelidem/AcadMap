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

export interface Credential {
  userId: ID;
  salt: string;
  hash: string;
  /** Single-use recovery token issued by "forgot password". */
  resetToken: string | null;
  resetExpiresAt: string | null;
}

export interface Database {
  version: number;
  sessionUserId: ID | null;
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
const DB_VERSION = 1;

function emptyDatabase(): Database {
  return {
    version: DB_VERSION,
    sessionUserId: null,
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

function load(): Database {
  if (typeof localStorage === 'undefined') return emptyDatabase();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDatabase();
    const parsed = JSON.parse(raw) as Partial<Database>;
    // Merge over defaults so older payloads gain new collections safely.
    return { ...emptyDatabase(), ...parsed, version: DB_VERSION };
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
    db = { ...emptyDatabase(), ...(JSON.parse(raw) as Partial<Database>), version: DB_VERSION };
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

/** Insert helper for the array collections. */
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

export function removeRow(key: keyof Database, id: ID): void {
  update((current) => ({
    ...current,
    [key]: (current[key] as unknown as { id: ID }[]).filter((row) => row.id !== id),
  }));
}
