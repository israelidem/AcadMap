/**
 * The streak flame.
 *
 * Every other figure in AcadMap reports something that already happened — a
 * grade, a unit count, a GPA. A streak is the only one about momentum, so it is
 * the only one allowed to move, and the one place a little warmth belongs on
 * otherwise cool printed stock.
 *
 * Three rules keep it from becoming decoration:
 *
 *   1. It is never lit for nothing. At zero days there is no flame — an outline
 *      of one, set back in grey. A product that shows a burning streak to
 *      somebody with no streak has taught them the icon means nothing.
 *   2. It gets hotter as the run gets longer, so the icon carries information
 *      the number already states and can be read at a glance from across a
 *      phone: amber for a few days, red past a week, doubled glow past a month.
 *   3. It shows when the run is at risk. The streak model counts back from
 *      yesterday if today has no completed session yet, so a student can be on
 *      day nine and one skipped evening from zero without knowing it. That state
 *      is drawn hollow and named in the tooltip — the most useful thing the
 *      flame can say.
 */

import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'h-3.5 w-3.5',
  md: 'h-[1.05rem] w-[1.05rem]',
  lg: 'h-5 w-5',
} as const;

interface Tier {
  tone: string;
  /** Solid from three days on: a run worth protecting reads as a body, not a line. */
  solid: boolean;
  /** Layers of blurred flame behind the glyph. */
  glow: 0 | 1 | 2;
  name: string;
}

function tierOf(days: number): Tier | null {
  if (days >= 30) return { tone: 'text-danger', solid: true, glow: 2, name: 'blazing' };
  if (days >= 7) return { tone: 'text-danger/85', solid: true, glow: 1, name: 'burning' };
  if (days >= 3) return { tone: 'text-warning', solid: true, glow: 1, name: 'lit' };
  if (days >= 1) return { tone: 'text-warning', solid: false, glow: 0, name: 'catching' };
  return null;
}

export function StreakFlame({
  days,
  atRisk = false,
  size = 'md',
  className,
}: {
  days: number;
  /** True when the run is alive on yesterday's session but today is not logged. */
  atRisk?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const tier = tierOf(days);
  const glyph = SIZES[size];

  // Unlit: the shape without the heat, so the icon's meaning stays honest.
  if (!tier) {
    return (
      <Flame
        className={cn(glyph, 'shrink-0 text-muted/45', className)}
        strokeWidth={1.5}
        aria-hidden
      />
    );
  }

  const label = atRisk
    ? `${days}-day streak — today not logged yet`
    : `${days}-day streak, ${tier.name}`;

  return (
    <span
      className={cn('relative inline-flex shrink-0', glyph, className)}
      title={label}
      role="img"
      aria-label={label}
    >
      {/*
       * The heat: the same glyph, blurred, sitting behind. Two layers past a
       * month so a long run is unmistakable without changing the icon's size and
       * disturbing the row it sits in.
       */}
      {tier.glow > 0 && !atRisk && (
        <>
          <Flame
            className={cn('absolute inset-0 h-full w-full blur-[3px]', tier.tone)}
            fill="currentColor"
            aria-hidden
          />
          {tier.glow === 2 && (
            <Flame
              className={cn('absolute inset-0 h-full w-full opacity-60 blur-[6px]', tier.tone)}
              fill="currentColor"
              aria-hidden
            />
          )}
        </>
      )}

      <Flame
        className={cn(
          'relative h-full w-full',
          // At risk, the flame is drawn hollow and still: the run is not out, but
          // it is not earned today either, and it should not look like it was.
          atRisk ? 'text-warning/70' : cn(tier.tone, 'animate-flicker'),
        )}
        fill={tier.solid && !atRisk ? 'currentColor' : 'none'}
        strokeWidth={atRisk ? 1.5 : 1.75}
        aria-hidden
      />
    </span>
  );
}
