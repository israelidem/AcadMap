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
  update,
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

/*
 * The bug these cover cost a student every course and result they recorded: the
 * action layer writes through `update()` rather than the helpers above, so rows
 * were saved with no timestamp, read as dated 1970, and never offered to the
 * server. Stamping now happens in `update()` itself, which is the only place no
 * write can go around.
 */
describe('update stamps whatever a write changed', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('stamps a row added without a timestamp of its own', () => {
    // Exactly what `createCourse` does: build the row, hand back a new array.
    update((current) => ({ ...current, courses: [...current.courses, course('c1')] }));

    const row = getDatabase().courses[0] as Course & { updatedAt?: string };
    expect(typeof row.updatedAt).toBe('string');
  });

  it('stamps an edited row, so the edit is offered to the server', () => {
    update((current) => ({ ...current, courses: [course('c1')] }));
    const before = (getDatabase().courses[0] as Course & { updatedAt: string }).updatedAt;

    update((current) => ({
      ...current,
      courses: current.courses.map((row) =>
        row.id === 'c1' ? { ...row, units: 4 } : row,
      ),
    }));

    const after = getDatabase().courses[0] as Course & { updatedAt: string };
    expect(after.units).toBe(4);
    expect(after.updatedAt >= before).toBe(true);
  });

  it('leaves a row that arrived from the server alone', () => {
    /*
     * The stamp a pulled row carries belongs to the device that made the edit.
     * Re-stamping it here would make every pull look like a local change and push
     * the whole account straight back on the next exchange.
     */
    const remote = { ...course('c1'), updatedAt: '2026-03-01T10:00:00.000Z' };
    update((current) => ({ ...current, courses: [remote as Course] }));

    const row = getDatabase().courses[0] as Course & { updatedAt: string };
    expect(row.updatedAt).toBe('2026-03-01T10:00:00.000Z');
  });

  it('does not touch rows a write left as they were', () => {
    update((current) => ({ ...current, courses: [course('c1'), course('c2')] }));
    const untouched = getDatabase().courses[0];

    // Editing c2 must not disturb c1 — including its identity, which is how the
    // store tells "changed" from "carried over".
    update((current) => ({
      ...current,
      courses: current.courses.map((row) =>
        row.id === 'c2' ? { ...row, units: 5 } : row,
      ),
    }));

    expect(getDatabase().courses[0]).toBe(untouched);
  });

  it('ignores collections that do not sync', () => {
    update((current) => ({
      ...current,
      announcements: [{ id: 'a1', title: 'x', body: 'y' } as never],
    }));

    const row = getDatabase().announcements[0] as { updatedAt?: string };
    expect(row.updatedAt).toBeUndefined();
  });
});


