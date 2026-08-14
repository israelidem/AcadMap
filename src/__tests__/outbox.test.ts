/**
 * What the sync engine offers the server, and when it stops offering it.
 *
 * These cover the bug that lost a student their academic record while their
 * dashboard synced fine. Pushes used to be chosen by timestamp — rows newer than
 * the last completed sync — and a first upload goes in batches. The sync clock
 * moved on after each batch, so from the second batch onwards every row still
 * waiting looked as though it had already been sent, and was dropped silently.
 *
 * The queue is now explicit, and the two properties that matter are: everything
 * eventually goes, and nothing is forgotten until the server has it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '@shared/types';

const sync = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, sync } };
});

const { getDatabase, resetDatabase, update } = await import('@/lib/store');
const { syncNow, forgetSyncState } = await import('@/lib/sync');

const USER = '11111111-1111-4111-8111-111111111111';

function course(): Course {
  return {
    id: crypto.randomUUID(),
    userId: USER,
    termId: null,
    code: 'CHM101',
    title: 'Organic Chemistry',
    units: 3,
    priority: 'MEDIUM',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Course;
}

/** An account signed in on this device, holding `count` courses it has written. */
function withCourses(count: number): Course[] {
  const courses = Array.from({ length: count }, course);
  update((current) => ({ ...current, sessionUserId: USER, courses }));
  return courses;
}

const accepted = { rows: [], syncedAt: '2026-06-01T12:00:00.000Z', hasMore: false };

beforeEach(() => {
  resetDatabase();
  forgetSyncState(USER);
  sync.mockReset();
  sync.mockResolvedValue(accepted);
});

describe('what this device offers the server', () => {
  it('sends everything it holds, over as many requests as that takes', async () => {
    // 401 rows: one more than fits in a request, which is precisely the case the
    // old timestamp comparison got wrong.
    const courses = withCourses(401);

    await syncNow();

    const sent = sync.mock.calls.flatMap(([body]) => body.rows.map((row: { id: string }) => row.id));
    expect(sync).toHaveBeenCalledTimes(2);
    expect(new Set(sent)).toEqual(new Set(courses.map((c) => c.id)));
    expect(getDatabase().outbox).toEqual([]);
  });

  it('offers a row once the server has taken it, and not again', async () => {
    withCourses(2);
    await syncNow();
    sync.mockClear();

    await syncNow();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0][0].rows).toEqual([]);
  });

  it('keeps rows queued when the request fails', async () => {
    withCourses(3);
    sync.mockRejectedValue(new Error('network down'));

    await syncNow();

    // Nothing was forgotten...
    expect(getDatabase().outbox).toHaveLength(3);

    // ...so the next attempt still has all three to deliver.
    sync.mockResolvedValue(accepted);
    await syncNow();
    expect(sync.mock.calls.at(-1)?.[0].rows).toHaveLength(3);
    expect(getDatabase().outbox).toEqual([]);
  });

  it('sends an edit made while the previous request was in flight', async () => {
    const [first] = withCourses(1);

    let release = (): void => {};
    sync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(accepted);
        }),
    );

    const running = syncNow();
    // The student keeps working: the row changes before the server has replied.
    update((current) => ({
      ...current,
      courses: current.courses.map((row) => (row.id === first.id ? { ...row, units: 4 } : row)),
    }));
    release();
    await running;

    /*
     * The edit must survive the clean-up. Clearing the whole queue on success
     * would drop it, and the row's stamp is already newer than the sync it was
     * left out of — so nothing would ever pick it up again.
     */
    expect(getDatabase().outbox).toEqual([`courses:${first.id}`]);

    await syncNow();
    expect(sync.mock.calls.at(-1)?.[0].rows[0].data.units).toBe(4);
  });

  it('sends deletes, and drops queue entries nothing is left for', async () => {
    const { removeRow } = await import('@/lib/store');
    const [only] = withCourses(1);
    await syncNow();
    sync.mockClear();

    removeRow('courses', only.id);
    await syncNow();

    const rows = sync.mock.calls[0][0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ collection: 'courses', id: only.id });
    expect(rows[0].deletedAt).toBeTruthy();
    expect(getDatabase().outbox).toEqual([]);
  });
});
