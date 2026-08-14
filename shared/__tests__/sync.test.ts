/**
 * Sync engine tests.
 *
 * These encode the promises made to the student: work done on two devices is
 * never silently thrown away, changes that do not collide merge without asking,
 * and a delete stays deleted.
 */

import { describe, expect, it } from 'vitest';
import {
  applyResolutions,
  changedFields,
  mergeCollection,
  pruneTombstones,
  visible,
  type Conflict,
  type SyncMeta,
} from '../sync';

interface Row extends SyncMeta {
  name: string;
  units: number;
}

const LAST_SYNC = '2026-03-02T10:00:00.000Z';
const BEFORE = '2026-03-02T09:00:00.000Z';
const AFTER = '2026-03-02T11:00:00.000Z';
const LATER = '2026-03-02T12:00:00.000Z';

function row(id: string, overrides: Partial<Row> = {}): Row {
  return { id, name: `Row ${id}`, units: 3, updatedAt: BEFORE, deletedAt: null, ...overrides };
}

function merge(local: Row[], remote: Row[], lastSyncedAt: string | null = LAST_SYNC) {
  return mergeCollection(local, remote, { lastSyncedAt, collection: 'courses' });
}

describe('mergeCollection', () => {
  it('keeps unrelated work from both devices', () => {
    // The phone added one course, the laptop another. Neither should be lost and
    // the student should not be asked anything.
    const fromPhone = row('phone', { updatedAt: AFTER });
    const fromLaptop = row('laptop', { updatedAt: AFTER });

    const result = merge([fromPhone], [fromLaptop]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.merged.map((r) => r.id).sort()).toEqual(['laptop', 'phone']);
    // Only the row the server has never seen needs pushing.
    expect(result.toPush.map((r) => r.id)).toEqual(['phone']);
  });

  it('raises a conflict when both devices edited the same row', () => {
    const mine = row('c1', { name: 'Organic Chemistry', updatedAt: AFTER });
    const theirs = row('c1', { name: 'Organic Chem I', updatedAt: LATER });

    const result = merge([mine], [theirs]);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ collection: 'courses', id: 'c1' });
    expect(result.conflicts[0].changedFields).toEqual(['name']);
    // The screen must not change under the student while they decide.
    expect(result.merged.find((r) => r.id === 'c1')?.name).toBe('Organic Chemistry');
    // Nothing is pushed until the conflict is resolved.
    expect(result.toPush).toHaveLength(0);
  });

  it('does not invent a conflict when only this device edited the row', () => {
    const mine = row('c1', { units: 4, updatedAt: AFTER });
    const theirs = row('c1', { units: 3, updatedAt: BEFORE });

    const result = merge([mine], [theirs]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.merged[0].units).toBe(4);
    expect(result.toPush).toHaveLength(1);
  });

  it('accepts the server version when only the other device edited the row', () => {
    const mine = row('c1', { units: 3, updatedAt: BEFORE });
    const theirs = row('c1', { units: 5, updatedAt: AFTER });

    const result = merge([mine], [theirs]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.merged[0].units).toBe(5);
    // The server already has it; pushing would be pointless traffic.
    expect(result.toPush).toHaveLength(0);
  });

  it('treats identical rows as nothing to do', () => {
    const result = merge([row('c1')], [row('c1')]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.toPush).toHaveLength(0);
    expect(result.merged).toHaveLength(1);
  });

  it('pushes rows the server has never seen', () => {
    const result = merge([row('new', { updatedAt: AFTER })], []);

    expect(result.toPush.map((r) => r.id)).toEqual(['new']);
    expect(result.merged).toHaveLength(1);
  });

  it('adopts rows this device has never seen', () => {
    const result = merge([], [row('remote')]);

    expect(result.merged.map((r) => r.id)).toEqual(['remote']);
    expect(result.toPush).toHaveLength(0);
  });

  it('replicates a delete instead of resurrecting the row', () => {
    // Deleted here after the last sync; the server still has it live.
    const deletedHere = row('c1', { updatedAt: AFTER, deletedAt: AFTER });
    const liveThere = row('c1', { updatedAt: BEFORE });

    const result = merge([deletedHere], [liveThere]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.merged[0].deletedAt).toBe(AFTER);
    expect(result.toPush).toHaveLength(1);
    expect(visible(result.merged)).toHaveLength(0);
  });

  it('treats every local row as a change on a device that has never synced', () => {
    // Signing in on a laptop that already holds guest data: none of it has ever
    // been sent, so all of it must be pushed.
    const result = merge([row('a'), row('b')], [], null);

    expect(result.toPush).toHaveLength(2);
  });

  it('reports a conflict per row rather than one for the whole collection', () => {
    const local = [
      row('c1', { name: 'Local one', updatedAt: AFTER }),
      row('c2', { name: 'Local two', updatedAt: AFTER }),
      row('c3', { updatedAt: BEFORE }),
    ];
    const remote = [
      row('c1', { name: 'Remote one', updatedAt: AFTER }),
      row('c2', { name: 'Remote two', updatedAt: AFTER }),
      row('c3', { updatedAt: BEFORE }),
    ];

    const result = merge(local, remote);

    expect(result.conflicts.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });
});

describe('changedFields', () => {
  it('ignores the sync clock so a re-save is not treated as an edit', () => {
    expect(changedFields(row('c1', { updatedAt: AFTER }), row('c1', { updatedAt: LATER }))).toEqual(
      [],
    );
  });

  it('names every field that differs', () => {
    const fields = changedFields(
      row('c1', { name: 'A', units: 2 }),
      row('c1', { name: 'B', units: 3 }),
    );

    expect(fields).toEqual(['name', 'units']);
  });

  it('compares nested values structurally', () => {
    const a = { ...row('c1'), rules: [{ point: 5 }] } as unknown as Row;
    const b = { ...row('c1'), rules: [{ point: 5 }] } as unknown as Row;
    const c = { ...row('c1'), rules: [{ point: 4 }] } as unknown as Row;

    expect(changedFields(a, b)).toEqual([]);
    expect(changedFields(a, c)).toEqual(['rules']);
  });
});

describe('applyResolutions', () => {
  const local = row('c1', { name: 'Mine', updatedAt: AFTER });
  const remote = row('c1', { name: 'Theirs', updatedAt: LATER });
  const conflict: Conflict<Row> = {
    collection: 'courses',
    id: 'c1',
    local,
    remote,
    changedFields: ['name'],
  };

  it('keeps the version the student chose to discard the other', () => {
    const { rows } = applyResolutions([local], [conflict], { c1: 'REMOTE' }, LATER);

    expect(rows[0].name).toBe('Theirs');
  });

  it('re-stamps a local win so the conflict does not come back', () => {
    const resolvedAt = '2026-03-02T13:00:00.000Z';
    const { rows, toPush } = applyResolutions([local], [conflict], { c1: 'LOCAL' }, resolvedAt);

    expect(rows[0].name).toBe('Mine');
    // Must now be newer than the remote copy it beat, or the next sync would ask again.
    expect(rows[0].updatedAt).toBe(resolvedAt);
    expect(rows[0].updatedAt > remote.updatedAt).toBe(true);
    expect(toPush).toHaveLength(1);
  });

  it('defaults to what the student can already see', () => {
    const { rows } = applyResolutions([local], [conflict], {}, LATER);

    expect(rows[0].name).toBe('Mine');
  });

  it('leaves rows that were never in conflict alone', () => {
    const other = row('c2');
    const { rows } = applyResolutions([local, other], [conflict], { c1: 'REMOTE' }, LATER);

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === 'c2')).toEqual(other);
  });
});

describe('pruneTombstones', () => {
  const now = '2026-06-01T00:00:00.000Z';

  it('keeps recent tombstones so offline devices still learn about the delete', () => {
    const recent = row('c1', { deletedAt: '2026-05-30T00:00:00.000Z' });

    expect(pruneTombstones([recent], now)).toHaveLength(1);
  });

  it('drops tombstones past the retention window', () => {
    const ancient = row('c1', { deletedAt: '2026-01-01T00:00:00.000Z' });

    expect(pruneTombstones([ancient], now)).toHaveLength(0);
  });

  it('never drops a live row', () => {
    expect(pruneTombstones([row('c1')], now)).toHaveLength(1);
  });
});

describe('visible', () => {
  it('hides deleted rows from the app', () => {
    const rows = [row('live'), row('gone', { deletedAt: AFTER })];

    expect(visible(rows).map((r) => r.id)).toEqual(['live']);
  });
});
