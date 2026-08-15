/**
 * The AcadMap mark and wordmark.
 *
 * One component so the logo appears in exactly one place in the source: it is
 * used on the landing page, the auth screens, onboarding, the app header and
 * shared snapshots, and the point of a brand is that all six are the same.
 *
 * `public/logo.png` rather than an import, because the same file is the source
 * the favicon and PWA icons are generated from (`scripts/generate-icons.mjs`),
 * and going through the bundler would fingerprint it and split the two apart.
 *
 * The alt text is empty on purpose. Every use sits beside the word "AcadMap",
 * so a screen reader announcing the mark as well would simply say it twice.
 */

import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt=""
      aria-hidden
      width={512}
      height={512}
      // Sized by the caller through the utility classes, as the icons it replaces
      // were; the intrinsic size is declared only to reserve the space.
      className={cn('h-6 w-6 shrink-0 object-contain', className)}
    />
  );
}

/**
 * The wordmark: the mark seated in a ruled plate, then the name in the wide
 * display face. The plate is the registry stamp the rest of the interface
 * borrows from, which is why the logo is where it is introduced.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-2 whitespace-nowrap', className)}>
      <span className="grid h-7 w-7 place-items-center rounded-md border border-brand/40 bg-brand-soft">
        <LogoMark className="h-4 w-4" />
      </span>
      <span className="font-display text-base font-bold uppercase tracking-[0.14em] text-fg">
        Acad<span className="text-brand">Map</span>
      </span>
    </span>
  );
}
