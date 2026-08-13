// @vitest-environment jsdom
/**
 * The owner role is stored on the account row, so an account registered before
 * the owner address was configured would keep seeing 403 at /admin. These cover
 * the startup reconciliation that fixes it.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@shared/types';
import { OWNER_EMAIL, syncOwnerRole } from '../lib/auth';
import { getDatabase, resetDatabase, update } from '../lib/store';

function seed(users: Pick<User, 'email' | 'role'>[]): void {
  update((current) => ({
    ...current,
    users: users.map((user, index) => ({
      id: `usr_${index}`,
      email: user.email,
      role: user.role,
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: '2026-01-01T00:00:00.000Z',
    })),
  }));
}

const roleOf = (email: string) => getDatabase().users.find((user) => user.email === email)?.role;

describe('syncOwnerRole', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('promotes an account registered before the owner address was configured', () => {
    seed([{ email: OWNER_EMAIL, role: 'STUDENT' }]);
    syncOwnerRole();
    expect(roleOf(OWNER_EMAIL)).toBe('OWNER');
  });

  it('leaves other students alone', () => {
    seed([
      { email: OWNER_EMAIL, role: 'STUDENT' },
      { email: 'student@example.com', role: 'STUDENT' },
    ]);
    syncOwnerRole();
    expect(roleOf('student@example.com')).toBe('STUDENT');
  });

  it('demotes a previous owner so admin is never shared', () => {
    seed([
      { email: OWNER_EMAIL, role: 'STUDENT' },
      { email: 'former-owner@example.com', role: 'OWNER' },
    ]);
    syncOwnerRole();
    expect(roleOf('former-owner@example.com')).toBe('STUDENT');
    expect(roleOf(OWNER_EMAIL)).toBe('OWNER');
  });
});
