import clsx, { type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/**
 * Generates a row id.
 *
 * Ids are real UUIDs because rows are created on the device — including with no
 * connection — and must keep their identity when they reach Postgres, where
 * every primary key is a `UUID`. A prefixed string like `crs_a1b2` cannot be
 * stored in a UUID column, and letting the server assign ids instead would make
 * offline creation impossible.
 *
 * `prefix` is accepted and ignored. Call sites read better naming the kind of
 * row they are making, and keeping the parameter avoided touching every one of
 * them when the format changed.
 */
export function uid(prefix = 'id'): string {
  void prefix;
  // Held in a local so the feature checks below do not narrow the global away.
  const webCrypto: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;

  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();

  // Fallback for the rare environment without randomUUID: still a valid v4, so
  // the database accepts it.
  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** True for a canonical UUID, used to spot ids minted before the format change. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}


export function nowIso(): string {
  return new Date().toISOString();
}

export function formatNumber(value: number, dp = 2): string {
  return value.toFixed(dp);
}

/** Parses a numeric input, returning null for empty/invalid values. */
export function parseNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function sortBy<T>(items: T[], key: (item: T) => string | number): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}
