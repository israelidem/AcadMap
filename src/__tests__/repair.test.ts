// @vitest-environment jsdom

/**
 * Opening the app on a device whose account is already half-uploaded.
 *
 * Runs in jsdom because the point is what `localStorage` holds: the repair
 * happens as the stored snapshot is read, before any code has a chance to ask.

 *
 * This is the state real accounts are in right now: rows were stamped, some were
 * sent, and the rest were skipped because the sync clock had moved past them.
 * Nothing on the device says which is which, so the repair queues everything and
 * lets the server sort it out — it upserts, so a row sent twice is written twice
 * with the same values.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'acadmap.db.v1';
const USER = '22222222-2222-4222-8222-222222222222';
const RESULT = '33333333-3333-4333-8333-333333333333';
const COURSE = '44444444-4444-4444-8444-444444444444';

/** A snapshot as the previous release left it: stamped, version 3, no queue. */
function halfSyncedSnapshot() {
  return {
    version: 3,
    sessionUserId: USER,
    tombstones: [{ id: 'deleted-one', collection: 'courses', deletedAt: '2026-05-01T00:00:00.000Z' }],
    profiles: [{ id: USER, userId: USER, fullName: 'Ada', updatedAt: '2026-05-01T00:00:00.000Z' }],
    courses: [{ id: COURSE, userId: USER, code: 'CHM101', updatedAt: '2026-05-01T00:00:00.000Z' }],
    // The academic record: present on the device, never uploaded.
    results: [{ id: RESULT, userId: USER, score: 71, updatedAt: '2026-05-01T00:00:00.000Z' }],
  };
}

async function openApp() {
  vi.resetModules();
  return import('@/lib/store');
}

describe('opening a half-synced account', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('queues every row it holds, including the ones that never went', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(halfSyncedSnapshot()));

    const { getDatabase } = await openApp();
    const outbox = getDatabase().outbox;

    expect(outbox).toContain(`results:${RESULT}`);
    expect(outbox).toContain(`courses:${COURSE}`);
    expect(outbox).toContain(`profiles:${USER}`);
    // Deletes are owed as well, or a course removed here comes back from another
    // device on the next pull.
    expect(outbox).toContain('courses:deleted-one');
  });

  it('leaves the rows themselves untouched', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(halfSyncedSnapshot()));

    const { getDatabase } = await openApp();
    const db = getDatabase();

    // The repair is about what is owed, not about the data: re-stamping would
    // make every local copy look newer than the server's and win merges it
    // should lose.
    expect(db.results[0]).toMatchObject({ score: 71, updatedAt: '2026-05-01T00:00:00.000Z' });
    expect(db.version).toBe(4);
  });

  it('does not queue anything on an account that is already up to date', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...halfSyncedSnapshot(), version: 4, outbox: [] }),
    );

    const { getDatabase } = await openApp();

    expect(getDatabase().outbox).toEqual([]);
  });
});
