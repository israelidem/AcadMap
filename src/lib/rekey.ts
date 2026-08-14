/**
 * Re-keying a device's data onto a different user id.
 *
 * Accounts created before AcadMap had server accounts were given an id invented
 * on the device. When such an account is claimed, the server issues the real id,
 * and every row this device holds has to move to it — a synced row is keyed by
 * user id, so leaving the old one behind would make one student look like two
 * accounts, each holding half a transcript.
 *
 * The replacement is deliberately blunt: any string anywhere in the store that
 * equals the old id becomes the new one, and object keys are replaced too, which
 * is what carries `preferences`, keyed by user id rather than storing it. Being
 * blunt is what makes it safe here — ids are random and unique, so no other
 * field can collide with one, and a field-by-field list would silently miss
 * whichever reference was added last (`actorUserId`, `ownerId`, a future one).
 *
 * Pure and structural, so it can be tested against a whole database snapshot
 * without a browser.
 */

/** Replaces every occurrence of `oldId` — in values and in keys — with `newId`. */
export function rekeyIds<T>(value: T, oldId: string, newId: string): T {
  if (oldId === newId) return value;

  if (typeof value === 'string') {
    return (value === oldId ? newId : value) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => rekeyIds(item, oldId, newId)) as unknown as T;
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key === oldId ? newId : key] = rekeyIds(item, oldId, newId);
    }
    return out as unknown as T;
  }

  return value;
}
