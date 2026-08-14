/**
 * Typed client for the AcadMap API.
 *
 * Every call goes through `request`, so authentication (a cookie), JSON encoding,
 * error shape and offline detection are handled in exactly one place. Errors
 * arrive as `ApiError`, which carries the HTTP status so callers can distinguish
 * "you are signed out" (401) from "that is not yours" (403) or "no connection"
 * (status 0) without string matching.
 *
 * The API is same-origin in the normal Vercel deployment, so requests are made
 * against relative paths and cookies are sent automatically.
 */

import type { ID, Profile } from '@shared/types';
import type { ImportBundle, ProfileInput } from '@shared/schemas';


export class ApiError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }

  /** True when the failure is the connection rather than the request. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

interface RequestOptions {

  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  // A failed fetch and a browser that knows it is offline produce very different
  // messages for the student, so the cheap check is worth making first.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(0, 'You appear to be offline. Reconnect and try again.');
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Could not reach AcadMap. Check your connection and try again.');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ??
      `Request failed (${response.status}). Please try again.`;
    throw new ApiError(response.status, message);
  }

  return payload as T;
}

/*
 * Authentication is deliberately absent from this object.
 *
 * Signing up, signing in, sessions, password resets, changing a password and
 * deleting an account all belong to Better Auth, which has its own client (see
 * src/lib/auth.ts). Keeping a second, hand-written path to the same endpoints is
 * how the two drift apart.
 */
export const api = {
  /* ------------------------------- profile ------------------------------- */


  profile: (signal?: AbortSignal) => request<{ profile: Profile }>('/profile', { signal }),

  updateProfile: (patch: Partial<ProfileInput>) =>
    request<{ profile: Profile }>('/profile', { method: 'PATCH', body: patch }),

  /* ---------------------------- guest adoption --------------------------- */

  /**
   * Hands the local (guest) data to the new account. Runs once: the server
   * refuses with 409 if the account already holds academic data.
   */
  importGuestData: (bundle: ImportBundle) =>
    request<{ imported: Record<string, number | boolean> }>('/import', {
      method: 'POST',
      body: bundle,
    }),

  /* ------------------------------- feedback ------------------------------ */

  sendFeedback: (input: { category: string; message: string }) =>
    request<{ id: ID }>('/feedback', { method: 'POST', body: input }),

  /* --------------------------------- sync -------------------------------- */

  /**
   * One exchange of academic data with the account: this device's changes for
   * everyone else's. See src/lib/sync.ts for how the result is applied.
   */
  sync: (input: SyncRequest) => request<SyncResponse>('/sync', { method: 'POST', body: input }),
};

export interface SyncWireRow {
  collection: string;
  id: ID;
  data: Record<string, unknown>;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SyncRequest {
  /** Null on a device that has never synced, which asks for the whole account. */
  since: string | null;
  rows: SyncWireRow[];
}

export interface SyncResponse {
  rows: SyncWireRow[];
  /** The watermark to send as `since` next time. */
  syncedAt: string;
  /** True when the account had more changes than one response can carry. */
  hasMore: boolean;
}


