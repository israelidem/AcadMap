/**
 * Share-link tokens.
 *
 * A share URL is a bearer credential: anyone holding it can read the snapshot.
 * We therefore store only the SHA-256 of the token, exactly as we would a
 * password. If the database is ever exposed, the rows reveal no working links.
 *
 * Uses WebCrypto, which the edge runtime provides natively — no dependency.
 */

/** 128 bits of randomness, URL-safe, no ambiguous characters from base64. */
export function createShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
