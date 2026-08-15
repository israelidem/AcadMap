/**
 * Service-worker lifecycle UI.
 *
 * Updates are opt-in rather than silent: reloading underneath a student who is
 * mid-way through entering results would lose their typing. We show a banner and
 * let them choose the moment. A second banner reports offline mode, so an empty
 * dashboard is never mistaken for lost data.
 *
 * Opt-in only works if the offer actually arrives, though, and in the installed
 * app it did not. A standalone window is resumed from the app switcher for weeks
 * without ever being reloaded, and the service worker only looked for a new
 * version when the page loaded — so the installed app kept running the bundle it
 * was installed with. That is why a fix that plainly worked in the browser looked
 * broken in the installed app: same account, same server, older code.
 *
 * So updates are looked for on a timer and whenever the app comes back to the
 * front, and one that lands when nobody can be mid-sentence — during launch, or
 * while the app is in the background — is taken immediately rather than waiting
 * behind a banner nobody is there to read.
 */

import { useEffect, useRef, useState } from 'react';

/** How often a running app asks whether a new version has shipped. */
const UPDATE_CHECK_MS = 15 * 60_000;

export function ServiceWorkerBanner() {
  const [updateReady, setUpdateReady] = useState(false);
  const startedAt = useRef(Date.now());
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
    let stopChecking: (() => void) | null = null;

    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        const update = registerSW({
          immediate: true,
          onNeedRefresh() {
            if (cancelled) return;

            // Nothing to interrupt: the app has only just started, or it is in the
            // background. Take the new version now, because the alternative is an
            // installed app quietly running old code until someone reads a banner.
            const launching = Date.now() - startedAt.current < 20_000;
            const away = document.visibilityState !== 'visible';
            if (launching || away) {
              void update(true);
              return;
            }

            setUpdateReady(true);
          },
          onRegisteredSW(_url, registration) {
            if (!registration || cancelled) return;

            // A check is one conditional request for the worker script, and it is
            // the only thing that makes a long-lived standalone window notice a
            // release at all.
            const check = (): void => {
              if (document.visibilityState === 'visible') void registration.update();
            };

            const timer = setInterval(check, UPDATE_CHECK_MS);
            document.addEventListener('visibilitychange', check);
            stopChecking = () => {
              clearInterval(timer);
              document.removeEventListener('visibilitychange', check);
            };
          },
        });
        if (!cancelled) setApplyUpdate(() => () => void update(true));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      stopChecking?.();
    };
  }, []);


  if (!updateReady && !offline) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-20 z-50 mx-auto flex w-[min(28rem,calc(100%-2rem))] flex-col gap-2 sm:bottom-6"
      role="status"
      aria-live="polite"
    >
      {/* Both banners speak the app's palette through tokens, so they follow the
          theme instead of carrying their own light and dark variants. */}
      {offline && (
        <p className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning shadow-lift">
          You are offline. Your work is saved on this device and the GPA calculator
          still works.
        </p>
      )}

      {updateReady && applyUpdate && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm shadow-lift">
          <span className="flex-1">A new version of AcadMap is ready.</span>
          <button
            type="button"
            onClick={() => setUpdateReady(false)}
            className="am-focus rounded-lg px-3 py-1.5 font-mono text-micro uppercase text-muted hover:bg-surface-2 hover:text-fg"
          >
            Later
          </button>
          <button
            type="button"
            onClick={applyUpdate}
            className="am-focus rounded-lg border border-brand bg-brand px-3 py-1.5 font-mono text-micro uppercase text-brand-fg hover:bg-brand-ink"
          >
            Reload
          </button>
        </div>
      )}

    </div>
  );
}
