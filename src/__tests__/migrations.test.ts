/**
 * Stored-data migration tests.
 *
 * These run against data shaped like a real snapshot from an older build. A bug
 * here silently corrupts a student's existing courses and results, so the cases
 * below focus on references surviving the rewrite.
 */

import { describe, expect, it } from 'vitest';
import { migrateIdsToUuid, migrateSyncMetadata } from '@/lib/migrations';
import { isUuid } from '@/lib/utils';

describe('migrateIdsToUuid', () => {
  it('rewrites an id and every reference to it to the same UUID', () => {
    const before = {
      courses: [{ id: 'crs_9f2a1c', termId: 'trm_1122aa', name: 'Organic Chemistry' }],
      topics: [{ id: 'top_44bb99', courseId: 'crs_9f2a1c' }],
      sessions: [{ id: 'ses_77cc11', courseId: 'crs_9f2a1c', topicId: 'top_44bb99' }],
      terms: [{ id: 'trm_1122aa', label: 'First Semester' }],
    };

    const after = migrateIdsToUuid(before);

    const courseId = after.courses[0].id;
    const topicId = after.topics[0].id;
    const termId = after.terms[0].id;

    expect(isUuid(courseId)).toBe(true);
    expect(isUuid(topicId)).toBe(true);
    // The point of the whole exercise: references still resolve.
    expect(after.topics[0].courseId).toBe(courseId);
    expect(after.sessions[0].courseId).toBe(courseId);
    expect(after.sessions[0].topicId).toBe(topicId);
    expect(after.courses[0].termId).toBe(termId);
  });

  it('leaves the built-in grading system ids alone', () => {
    // `preset-5` is a shared constant, not a per-user row. Rewriting it would
    // detach it from PRESET_GRADING_SYSTEMS.
    const before = {
      gradingSystems: [{ id: 'preset-5', scale: 5 }],
      profiles: [{ userId: 'usr_abc123', gradingSystemId: 'preset-5' }],
    };

    const after = migrateIdsToUuid(before);

    expect(after.gradingSystems[0].id).toBe('preset-5');
    expect(after.profiles[0].gradingSystemId).toBe('preset-5');
  });

  it('rewrites ids used as object keys', () => {
    const before = {
      users: [{ id: 'usr_abc123' }],
      preferences: { usr_abc123: { theme: 'dark' } },
      sessionUserId: 'usr_abc123',
    };

    const after = migrateIdsToUuid(before);
    const userId = after.users[0].id;

    expect(isUuid(userId)).toBe(true);
    expect(after.sessionUserId).toBe(userId);
    // Preferences are keyed by user id, so the key must move with it.
    expect(Object.keys(after.preferences)).toEqual([userId]);
    expect(after.preferences[userId as keyof typeof after.preferences]).toEqual({ theme: 'dark' });
  });

  it('is a no-op once ids are already UUIDs', () => {
    const before = {
      courses: [{ id: '3f1c8a2e-9b47-4d6f-8a11-2c5e7b904d33', termId: null }],
    };

    expect(migrateIdsToUuid(before)).toEqual(before);
  });

  it('does not disturb data that holds no ids', () => {
    const before = { featureFlags: { plannerEnabled: true }, version: 1 };

    expect(migrateIdsToUuid(before)).toEqual(before);
  });

  it('gives two different old ids two different new ids', () => {
    const before = { courses: [{ id: 'crs_aaa111' }, { id: 'crs_bbb222' }] };

    const after = migrateIdsToUuid(before);

    expect(after.courses[0].id).not.toBe(after.courses[1].id);
  });
});

describe('migrateSyncMetadata', () => {
  const STAMP = '2026-08-14T06:00:00.000Z';

  it('stamps rows that predate sync', () => {
    const before = { courses: [{ id: 'a', createdAt: '2026-03-01T10:00:00.000Z' }] };

    const after = migrateSyncMetadata(before, ['courses'], STAMP);

    // createdAt is better evidence than "now": the row is old, not a fresh edit.
    expect(after.courses[0]).toMatchObject({
      updatedAt: '2026-03-01T10:00:00.000Z',
      deletedAt: null,
    });
  });

  it('falls back to the migration time when there is no createdAt', () => {
    const before = { availability: [{ id: 'a', weekday: 1 }] };

    const after = migrateSyncMetadata(before, ['availability'], STAMP);

    expect(after.availability[0]).toMatchObject({ updatedAt: STAMP, deletedAt: null });
  });

  it('leaves already-migrated rows untouched', () => {
    const row = { id: 'a', updatedAt: '2026-05-05T00:00:00.000Z', deletedAt: null };
    const after = migrateSyncMetadata({ courses: [row] }, ['courses'], STAMP);

    expect(after.courses[0]).toBe(row);
  });

  it('preserves an existing tombstone', () => {
    const before = { courses: [{ id: 'a', deletedAt: '2026-04-01T00:00:00.000Z' }] };

    const after = migrateSyncMetadata(before, ['courses'], STAMP);

    expect(after.courses[0].deletedAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('ignores collections that are absent from an older snapshot', () => {
    const after = migrateSyncMetadata({ courses: [] }, ['courses', 'goals'], STAMP);

    expect(after).toEqual({ courses: [] });
  });
});
