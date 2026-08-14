/**
 * Store write-path tests.
 *
 * `insert`, `patchRow` and `removeRow` are the choke points every mutation goes
 * through, and they are now also where sync bookkeeping is applied. If a write
 * escapes unstamped the row silently never leaves the device, so these cases
 * pin the behaviour down.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Course } from '@shared/types';
import {
  getDatabase,
  insert,
  patchRow,
  removeRow,
  resetDatabase,
} from '@/lib/store';

function course(id: string): Course {
  return {
    id,
    userId: 'u1',
    termId: null,
    code: 'CHM101',
    title: 'Organic Chemistry',
    units: 3,

    priority: 'MEDIUM',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Course;
}

describe('store write path', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('stamps inserted rows in synced collections', () => {
    insert('courses', course('c1'));

    const row = getDatabase().courses[0] as Course & { updatedAt?: string };
    expect(typeof row.updatedAt).toBe('string');
  });

  it('leaves collections that never sync unstamped', () => {
    // Announcements are authored by the owner server-side, not synced per student.
    insert('announcements', {
      id: 'a1',
      title: 'Exam timetable is out',
      body: 'Check the portal.',
      publishedAt: '2026-01-01T00:00:00.000Z',
    } as never);

    const row = getDatabase().announcements[0] as { updatedAt?: string };
    expect(row.updatedAt).toBeUndefined();
  });

  it('moves updatedAt forward on every patch', () => {
    insert('courses', course('c1'));
    const before = (getDatabase().courses[0] as Course & { updatedAt: string }).updatedAt;

    patchRow<Course>('courses', 'c1', { units: 4 });

    const after = getDatabase().courses[0] as Course & { updatedAt: string };
    expect(after.units).toBe(4);

    expect(after.updatedAt >= before).toBe(true);
  });

  it('records a tombstone when a synced row is deleted', () => {
    insert('courses', course('c1'));
    removeRow('courses', 'c1');

    const db = getDatabase();
    // Really gone, so existing read sites need no change...
    expect(db.courses).toHaveLength(0);
    // ...but the delete can still be replicated.
    expect(db.tombstones).toHaveLength(1);
    expect(db.tombstones[0]).toMatchObject({ id: 'c1', collection: 'courses' });
  });

  it('does not tombstone rows that never sync', () => {
    insert('announcements', { id: 'a1', title: 'x', body: 'y' } as never);
    removeRow('announcements', 'a1');

    expect(getDatabase().tombstones).toHaveLength(0);
  });

  it('keeps one tombstone per row however often the delete repeats', () => {
    insert('courses', course('c1'));
    removeRow('courses', 'c1');
    removeRow('courses', 'c1');

    expect(getDatabase().tombstones).toHaveLength(1);
  });

  it('tombstones each deleted row separately', () => {
    insert('courses', course('c1'));
    insert('courses', course('c2'));
    removeRow('courses', 'c1');
    removeRow('courses', 'c2');

    expect(getDatabase().tombstones.map((t) => t.id).sort()).toEqual(['c1', 'c2']);
  });
});
