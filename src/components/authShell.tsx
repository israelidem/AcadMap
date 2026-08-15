/**
 * Shared frame for the login / register / recovery screens.
 *
 * Framed as the form it is: a sheet with a ruled head, a printed reference line
 * and the fields beneath. The reference line is not decoration — it tells the
 * student which of the three forms they are on.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from './brand';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-rule">
        <div className="mx-auto w-full max-w-6xl px-4 py-3.5">
          <Link to="/" className="inline-flex rounded-md">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <p className="am-eyebrow">Student record</p>
        <h1 className="mt-2 text-2xl leading-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}

        <div className="am-card mt-6 px-5 py-6">{children}</div>
        {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
      </main>

      <footer className="mx-auto w-full max-w-md px-4 pb-8">
        <p className="border-t border-rule pt-3 font-mono text-micro uppercase text-muted">
          Your record stays on your device and syncs when you are online.
        </p>
      </footer>
    </div>
  );
}
