/**
 * Whether this device is in step with the account.
 *
 * Sync had no presence in the UI at all: it could fail on every attempt for days
 * — a lost session, a rejected batch — and the only symptom a student would ever
 * see is a second device that stays mysteriously empty. Nothing here is
 * decorative; it exists so a silent failure becomes a visible one.
 *
 * Quiet by default. A cloud icon that dims while idle, spins while working, and
 * only becomes a button worth pressing when something needs saying.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { getSyncState, subscribeSync, syncNow } from '@/lib/sync';
import { useSession } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Modal } from './ui';

/** "just now", "4 min ago", "yesterday" — a time nobody has to decode. */
function ago(iso: string | null): string {
  if (!iso) return 'not yet';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function SyncStatus() {
  const state = useSyncExternalStore(subscribeSync, getSyncState, getSyncState);
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  // Re-renders on a timer so "4 min ago" does not sit there going stale.
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!user) return null;

  const failing = state.error !== null;
  const conflicted = state.conflicts.length > 0;
  const label = failing
    ? 'Sync problem — tap for details'
    : state.running
      ? 'Syncing…'
      : `Synced ${ago(state.lastSyncedAt)}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={cn(
          'am-touch grid place-items-center rounded-xl hover:bg-surface-2',
          failing ? 'text-warning' : 'text-muted',
        )}
      >
        {failing ? (
          <CloudOff className="h-5 w-5" />
        ) : state.running ? (
          <RefreshCw className="h-5 w-5 animate-spin" />
        ) : (
          <Cloud className="h-5 w-5" />
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Sync">
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            Your work is saved on this device first, then copied to your account so
            your other devices can see it.
          </p>

          <p>
            <span className="text-muted">Last synced:</span>{' '}
            <span className="font-medium">{ago(state.lastSyncedAt)}</span>
          </p>

          {failing && (
            <div className="flex gap-2 rounded-xl bg-warning/10 p-3 text-warning">

              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{state.error}</p>
            </div>
          )}

          {conflicted && (
            <p className="text-muted">
              {state.conflicts.length}{' '}
              {state.conflicts.length === 1 ? 'record was' : 'records were'} changed on
              two devices at once. This device's version is the one on screen, and
              nothing has been overwritten.
            </p>
          )}

          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={state.running}
            className="am-touch inline-flex items-center gap-2 rounded-xl bg-brand px-4 font-medium text-white disabled:opacity-60"
          >
            <RefreshCw className={cn('h-4 w-4', state.running && 'animate-spin')} />
            {state.running ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </Modal>
    </>
  );
}
