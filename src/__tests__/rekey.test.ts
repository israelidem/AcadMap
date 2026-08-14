import { describe, expect, it } from 'vitest';
import { rekeyIds } from '../lib/rekey';

const OLD = 'local-abc123';
const NEW = '356fc141-de48-42ac-a410-000000000000';

describe('rekeyIds', () => {
  it('moves every reference to the account, whatever the field is called', () => {
    const before = {
      sessionUserId: OLD,
      users: [{ id: OLD, email: 'a@b.c' }],
      credentials: [{ userId: OLD, salt: 's', hash: 'h' }],
      courses: [
        { id: 'course-1', userId: OLD, title: 'Contracts' },
        { id: 'course-2', userId: 'someone-else', title: 'Torts' },
      ],
      activityLogs: [{ id: 'log-1', actorUserId: OLD }],
    };

    const after = rekeyIds(before, OLD, NEW);

    expect(after.sessionUserId).toBe(NEW);
    expect(after.users[0].id).toBe(NEW);
    expect(after.credentials[0].userId).toBe(NEW);
    expect(after.courses[0].userId).toBe(NEW);
    expect(after.activityLogs[0].actorUserId).toBe(NEW);
    // Another account's rows are none of its business.
    expect(after.courses[1].userId).toBe('someone-else');
  });

  it('re-keys collections that use the id as an object key', () => {
    const before: { preferences: Record<string, { theme: string }> } = {
      preferences: {
        [OLD]: { theme: 'dark' },
        'other-user': { theme: 'light' },
      },
    };


    const after = rekeyIds(before, OLD, NEW);

    expect(after.preferences[NEW]).toEqual({ theme: 'dark' });
    expect(after.preferences[OLD]).toBeUndefined();
    expect(after.preferences['other-user']).toEqual({ theme: 'light' });
  });

  it('leaves values that merely contain the id alone', () => {
    const after = rekeyIds({ note: `about ${OLD}`, id: OLD }, OLD, NEW);

    expect(after.note).toBe(`about ${OLD}`);
    expect(after.id).toBe(NEW);
  });

  it('does not touch other data types', () => {
    const before = { units: 3, done: true, when: null, tags: ['a', OLD] };

    const after = rekeyIds(before, OLD, NEW);

    expect(after).toEqual({ units: 3, done: true, when: null, tags: ['a', NEW] });
  });

  it('returns the value untouched when the id has not changed', () => {
    const before = { id: OLD };

    expect(rekeyIds(before, OLD, OLD)).toBe(before);
  });
});
