/**
 * The sync watermark: when this device last completed a sync, per account.
 *
 * Its own module because two very different parts of the app need it and must
 * not import each other. The sync engine reads and advances it; the store clears
 * it during a migration, and the store cannot import the sync engine — the sync
 * engine imports the store, and the store hydrates at module load, so the cycle
 * would run before either was ready.
 *
 * Kept outside the database snapshot on purpose. It is device-local bookkeeping,
 * not account data: carried to another device it would claim rows had already
 * been seen there, and that device would never pull them.
 */

const PREFIX = 'acadmap.sync.lastSyncedAt';

function key(userId: string): string {
  return `${PREFIX}.${userId}`;
}

export function lastSyncedAt(userId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(key(userId));
}

export function setLastSyncedAt(userId: string, at: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key(userId), at);
}

/** Clears one account's watermark so the next sync re-reads the whole account. */
export function forgetSyncState(userId: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key(userId));
}

/**
 * Clears every account's watermark on this device.
 *
 * Used by the migration that rescued rows saved without a timestamp: those rows
 * are only offered to the server if they look newer than the watermark, so the
 * watermark has to go with them.
 */
export function forgetAllSyncWatermarks(): void {
  if (typeof localStorage === 'undefined') return;
  const doomed: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const found = localStorage.key(index);
    if (found && found.startsWith(PREFIX)) doomed.push(found);
  }
  // Collected first: removing while iterating shifts the indices underneath.
  for (const found of doomed) localStorage.removeItem(found);
}
