/**
 * Service-worker lifecycle UI.
 *
 * Updates are opt-in rather than silent: reloading underneath a student who is
 * mid-way through entering results would lose their typing. We show a banner and
 * let them choose the moment. A second banner reports offline mode, so an empty
 * dashboard is never mistaken for lost data.
 */

import { useEffect, useState } from 'react';

export function ServiceWorkerBanner() {
  const [updateReady, setUpdateReady] = useState(false);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    // The virtual module only exists in a real build, so it is imported lazily
    // and failures are ignored: a missing service worker must not break the app.
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

    let cancelled = false;
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        const update = registerSW({
          immediate: true,
          onNeedRefresh() {
            if (!cancelled) setUpdateReady(true);
          },
        });
        if (!cancelled) setApplyUpdate(() => () => void update(true));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!updateReady && !offline) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-20 z-50 mx-auto flex w-[min(28rem,calc(100%-2rem))] flex-col gap-2 sm:bottom-6"
      role="status"
      aria-live="polite"
    >
      {offline && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          You are offline. Your work is saved on this device and the GPA calculator
          still works.
        </p>
      )}

      {updateReady && applyUpdate && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <span className="flex-1 text-slate-700 dark:text-slate-200">
            A new version of AcadMap is ready.
          </span>
          <button
            type="button"
            onClick={() => setUpdateReady(false)}
            className="rounded-lg px-3 py-1.5 font-medium text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Later
          </button>
          <button
            type="button"
            onClick={applyUpdate}
            className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
