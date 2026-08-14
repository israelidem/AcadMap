/**
 * The AcadMap mark.
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
