/**
 * Back-office furniture for the owner console.
 *
 * The student app is the record — manila paper, a student's own transcript. This
 * is the desk the record is kept on: cooler stock, square corners, no decorative
 * iconography, and every figure in a column you can run your eye down.
 *
 * The one idea behind all of it: an operator does not read twelve numbers, they
 * scan one column and stop where something moved. So metrics are rows in a
 * ledger — figure, this period, previous, change, shape — never a grid of cards
 * with a tinted icon in the corner, which is the layout every generated
 * dashboard reaches for and which makes twelve numbers take twelve glances.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { UsageEvent } from '@shared/types';
import { countEvents, countEventsBetween, dailyCounts, daysAgoIso } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { LogoMark } from '@/components/brand';

/* -------------------------------------------------------------------------- */
/*                                    Shell                                   */
/* -------------------------------------------------------------------------- */

export interface OpsSection {
  value: string;
  label: string;
  /** Shown against the section name when there is something waiting there. */
  count?: number;
}

/**
 * The console frame.
 *
 * `.am-ops` re-declares the colour tokens for everything inside it, so the whole
 * subtree shifts to graphite without a single admin-specific utility class in
 * the markup below. The gutters matter as much as the palette: this page sits
 * outside `AppShell`, so without a content column of its own it renders flush
 * against the window edge and reads as an unstyled page.
 */
export function OpsShell({
  email,
  sections,
  active,
  onChange,
  toolbar,
  children,
}: {
  email: string;
  sections: OpsSection[];
  active: string;
  onChange: (value: string) => void;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const current = sections.find((section) => section.value === active);

  return (
    <div className="am-ops min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[84rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-6">
          <LogoMark className="h-6 w-6 shrink-0 text-brand" />

          <p className="font-mono text-micro font-medium uppercase">
            AcadMap
            <span className="mx-1.5 text-muted">/</span>
            <span className="text-muted">Registry ops</span>
          </p>

          {/*
           * A rubber stamp, not a pill. This is the only screen in the product
           * where a click changes somebody else's account, and it should never be
           * mistaken for the student app at a glance.
           */}
          <span className="animate-stamp select-none border-2 border-danger px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-danger">
            Owner
          </span>

          <div className="ml-auto flex items-center gap-4">
            <span className="hidden font-mono text-micro text-muted sm:inline">{email}</span>
            {/* The installed PWA has no browser chrome, so this is the only way back. */}
            <Link
              to="/app"
              className="am-focus font-mono text-micro font-medium uppercase text-muted transition-colors hover:text-fg"
            >
              ← Exit
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[84rem] px-4 lg:px-6">
        <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10">
          <Rail sections={sections} active={active} onChange={onChange} />

          <div className="min-w-0 py-5 lg:py-8">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-4">
              <h1 className="text-xl leading-none sm:text-2xl">{current?.label ?? 'Overview'}</h1>
              {toolbar && <div className="am-row-x">{toolbar}</div>}
            </div>

            {/* On a phone the rail becomes a scrolling strip of the same list. */}
            <div className="am-scroll-x mb-5 flex gap-1 border-b border-border pb-px lg:hidden">
              {sections.map((section) => (
                <button
                  key={section.value}
                  type="button"
                  onClick={() => onChange(section.value)}
                  aria-current={section.value === active ? 'page' : undefined}
                  className={cn(
                    'am-focus -mb-px whitespace-nowrap border-b-2 px-3 py-2 font-mono text-micro uppercase transition-colors',
                    section.value === active
                      ? 'border-brand text-brand'
                      : 'border-transparent text-muted hover:text-fg',
                  )}
                >
                  {section.label}
                  {section.count ? (
                    <span className="ml-1.5 tabular text-[10px]">{section.count}</span>
                  ) : null}
                </button>
              ))}
            </div>

            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The section index.
 *
 * Numbered, because that is how a filing index is written and because it gives
 * the eye a fixed left edge to travel down. Eight sections in a horizontal
 * scroller — which is what a tab strip becomes at this count — hides half the
 * console behind a gesture on the widest screens.
 */
function Rail({
  sections,
  active,
  onChange,
}: {
  sections: OpsSection[];
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <aside className="hidden lg:block">
      <nav aria-label="Console sections" className="sticky top-[3.4rem] py-8">
        <p className="am-eyebrow mb-2 pl-3">Index</p>
        <ul className="border-l border-border">
          {sections.map((section, index) => {
            const selected = section.value === active;
            return (
              <li key={section.value}>
                <button
                  type="button"
                  onClick={() => onChange(section.value)}
                  aria-current={selected ? 'page' : undefined}
                  className={cn(
                    'am-focus group -ml-px flex w-full items-center gap-2.5 border-l-2 py-1.5 pl-3 pr-2 text-left transition-colors',
                    selected
                      ? 'border-brand bg-brand-soft/60 text-fg'
                      : 'border-transparent text-muted hover:border-border hover:text-fg',
                  )}
                >
                  <span
                    className={cn(
                      'tabular text-[10px] leading-none',
                      selected ? 'text-brand' : 'text-muted/70',
                    )}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-micro uppercase">
                    {section.label}
                  </span>
                  {section.count ? (
                    <span className="tabular shrink-0 border border-border px-1 text-[10px] leading-4">
                      {section.count}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Controls                                  */
/* -------------------------------------------------------------------------- */

/**
 * A four-value choice is a set of switches, not a dropdown.
 *
 * The range picker was a native `<select>`: an OS widget that ignores the type
 * and colour system entirely, and hides three of its four options behind a click
 * for no gain.
 */
export function Segmented({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex border border-border bg-surface">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'am-focus px-2.5 py-1.5 font-mono text-micro uppercase transition-colors',
              'border-r border-border last:border-r-0',
              selected ? 'bg-brand text-brand-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Figure ledger                               */
/* -------------------------------------------------------------------------- */

export interface Figure {
  label: string;
  /** A counted event: the ledger works out its own previous period and shape. */
  event?: UsageEvent['name'];
  /** A standing total — how many exist right now. There is no period to compare. */
  value?: number;
  note?: string;
  /** For figures where a rise is the bad news (skipped sessions). */
  inverse?: boolean;
}

export interface FigureGroup {
  label: string;
  description?: string;
  figures: Figure[];
}

/**
 * Every metric on one sheet.
 *
 * Grouped by ruled band rather than split across cards, so the whole console
 * state is a single column of figures read top to bottom — and so a period with
 * nothing in it reads as an empty ledger rather than twelve boxes each
 * displaying a bold zero, which looks like a fault.
 */
export function FiguresLedger({ groups, days }: { groups: FigureGroup[]; days: number }) {
  const since = daysAgoIso(days);
  const shapeDays = Math.max(10, days);

  return (
    <div className="am-scroll-x">
      <table className="w-full min-w-[580px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="am-eyebrow py-2 pr-4 text-left font-medium">
              Figure
            </th>
            <th scope="col" className="am-eyebrow py-2 pl-4 text-right font-medium">
              This period
            </th>
            <th scope="col" className="am-eyebrow hidden py-2 pl-4 text-right font-medium sm:table-cell">
              Previous
            </th>
            <th scope="col" className="am-eyebrow py-2 pl-4 text-right font-medium">
              Change
            </th>
            <th scope="col" className="am-eyebrow hidden py-2 pl-6 text-right font-medium md:table-cell">
              Shape
            </th>
          </tr>
        </thead>

        {groups.map((group) => (
          <tbody key={group.label}>
            <tr>
              {/* The band rule: a heading written across the columns, as on a form. */}
              <th
                scope="colgroup"
                colSpan={5}
                className="border-b border-rule bg-surface-2/70 px-0 py-1.5 text-left"
              >
                <span className="am-eyebrow text-fg">{group.label}</span>
                {group.description && (
                  <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted">
                    {group.description}
                  </span>
                )}
              </th>
            </tr>

            {group.figures.map((figure) => {
              const isEvent = typeof figure.event === 'string';
              const value = isEvent
                ? countEvents(figure.event as UsageEvent['name'], since)
                : (figure.value ?? 0);
              const previous = isEvent
                ? countEventsBetween(
                    figure.event as UsageEvent['name'],
                    daysAgoIso(days * 2),
                    since,
                  )
                : null;
              const series = isEvent
                ? dailyCounts([figure.event as UsageEvent['name']], shapeDays)
                : null;

              return (
                <tr
                  key={figure.label}
                  className="border-b border-rule transition-colors last:border-b-0 hover:bg-surface-2/50"
                >
                  <th scope="row" className="py-2.5 pr-4 text-left font-normal align-middle">
                    <span className="font-medium">{figure.label}</span>
                    {figure.note && (
                      <span className="ml-2 text-xs text-muted">{figure.note}</span>
                    )}
                  </th>

                  <td className="py-2.5 pl-4 text-right align-middle">
                    <span
                      className={cn(
                        'tabular text-xl leading-none',
                        // A zero is a fact, not an alarm: it is set back rather
                        // than printed at full strength alongside real counts.
                        value === 0 ? 'font-normal text-muted/60' : 'font-medium',
                      )}
                    >
                      {value}
                    </span>
                  </td>

                  <td className="hidden py-2.5 pl-4 text-right align-middle sm:table-cell">
                    <span className="tabular text-xs text-muted">
                      {previous === null ? '—' : previous}
                    </span>
                  </td>

                  <td className="py-2.5 pl-4 text-right align-middle">
                    <Delta value={value} previous={previous} inverse={figure.inverse} />
                  </td>

                  <td className="hidden py-2.5 pl-6 align-middle md:table-cell">
                    {series ? (
                      <Spark series={series} muted={value === 0} />
                    ) : (
                      <span className="block text-right text-xs text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/**
 * The change against the previous period of equal length.
 *
 * Direction is carried by an arrow glyph as well as colour, so the reading does
 * not depend on distinguishing forest green from oxblood.
 */
function Delta({
  value,
  previous,
  inverse,
}: {
  value: number;
  previous: number | null;
  inverse?: boolean;
}) {
  if (previous === null) {
    return <span className="tabular text-xs text-muted/60">—</span>;
  }

  if (previous === 0) {
    if (value === 0) {
      // Nothing this period, nothing last period: say so in words rather than
      // showing a 0% that implies something was measured.
      return <span className="font-mono text-[10px] uppercase text-muted/60">none yet</span>;
    }
    return <span className="font-mono text-[10px] uppercase text-success">new</span>;
  }

  const ratio = (value - previous) / previous;
  const rising = ratio > 0;
  const flat = Math.abs(ratio) < 0.005;
  const good = inverse ? !rising : rising;

  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-1 text-xs',
        flat ? 'text-muted' : good ? 'text-success' : 'text-danger',
      )}
    >
      <span aria-hidden>{flat ? '→' : rising ? '↗' : '↘'}</span>
      {flat ? '0%' : `${rising ? '+' : '−'}${Math.abs(Math.round(ratio * 100))}%`}
    </span>
  );
}

/** The row's own shape over the window — enough to tell a spike from a habit. */
function Spark({ series, muted }: { series: number[]; muted: boolean }) {
  const peak = Math.max(1, ...series);
  const step = 3;

  return (
    <svg
      viewBox={`0 0 ${series.length * step} 20`}
      preserveAspectRatio="none"
      className={cn('ml-auto block h-5 w-20', muted ? 'text-rule' : 'text-brand')}
      aria-hidden
    >
      {series.map((count, index) => {
        const height = count === 0 ? 1 : Math.max(2, (count / peak) * 20);
        return (
          <rect
            key={index}
            x={index * step}
            y={20 - height}
            width={step - 1}
            height={height}
            fill="currentColor"
            opacity={count === 0 ? 0.7 : 1}
          />
        );
      })}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Activity plot                               */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

export interface PlotSeries {
  label: string;
  values: number[];
  /** Kept to three because a stacked column stops being readable beyond that. */
  tone: 'brand' | 'accent' | 'soft';
}

/**
 * Daily activity, stacked.
 *
 * The old chart merged three event types into one bar, which answered "is
 * anything happening" and nothing else. Stacked, the same space answers the
 * question an owner actually has: activity is up, but is it opens (people
 * looking) or results and sessions (people working)?
 *
 * Weekends are shaded because study products live and die on them, and a mean
 * line is drawn so a column can be judged against the period rather than only
 * against the tallest day.
 */
export function ActivityPlot({ series, days }: { series: PlotSeries[]; days: number }) {
  const totals = Array.from({ length: days }, (_, index) =>
    series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
  );
  const peak = Math.max(1, ...totals);
  const sum = totals.reduce((a, b) => a + b, 0);
  const mean = sum / Math.max(1, days);
  const peakIndex = totals.indexOf(Math.max(...totals));

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dateFor = (index: number) => new Date(startOfDay.getTime() - (days - 1 - index) * DAY_MS);

  const fills: Record<PlotSeries['tone'], string> = {
    brand: 'bg-brand',
    accent: 'bg-accent',
    soft: 'bg-brand/35',
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="am-row-x gap-4">
          {series.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5 font-mono text-micro uppercase text-muted">
              <span className={cn('h-2.5 w-2.5', fills[item.tone])} aria-hidden />
              {item.label}
            </span>
          ))}
        </div>
        <p className="am-eyebrow">
          <span className="tabular text-fg">{sum}</span> events · peak{' '}
          <span className="tabular text-fg">{peak}</span> · mean{' '}
          <span className="tabular text-fg">{mean.toFixed(1)}</span>/day
        </p>
      </div>

      <div className="relative">
        {/* The mean, so a column is read against the period and not just the peak. */}
        <div
          className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-fg/35"
          style={{ bottom: `${(mean / peak) * 100}%` }}
          aria-hidden
        >
          <span className="absolute -top-4 right-0 bg-surface px-1 font-mono text-[10px] uppercase text-muted">
            mean
          </span>
        </div>

        <div
          className="am-plot flex h-40 items-end gap-px border-b border-l border-border"
          role="img"
          aria-label={`Daily activity: ${sum} events over ${days} days, peaking at ${peak}.`}
        >
          {totals.map((total, index) => {
            const date = dateFor(index);
            const weekend = date.getDay() === 0 || date.getDay() === 6;
            const breakdown = series
              .map((item) => `${item.label} ${item.values[index] ?? 0}`)
              .join(' · ');

            return (
              <div
                key={index}
                title={`${date.toDateString().slice(0, 10)} — ${breakdown}`}
                className={cn(
                  'group relative flex h-full flex-1 flex-col justify-end',
                  weekend && 'bg-fg/[0.04]',
                )}
              >
                {series.map((item) => {
                  const count = item.values[index] ?? 0;
                  if (count === 0) return null;
                  return (
                    <div
                      key={item.label}
                      className={cn('w-full origin-bottom animate-tally', fills[item.tone])}
                      style={{ height: `${(count / peak) * 100}%` }}
                    />
                  );
                })}
                {total === 0 && <div className="h-px w-full bg-border" />}
                {index === peakIndex && total > 0 && (
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 tabular text-[10px] text-muted">
                    {total}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-1.5 flex justify-between font-mono text-[10px] uppercase text-muted">
        <span>{dateFor(0).toDateString().slice(4, 10)}</span>
        <span className="hidden sm:inline">
          {dateFor(Math.floor(days / 2)).toDateString().slice(4, 10)}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Registers                                 */
/* -------------------------------------------------------------------------- */

/**
 * A blank field on a form, ruled and struck through — not a centred sentence
 * floating in a void, which is what an empty table used to be.
 */
export function BlankRegister({ title, description }: { title: string; description?: string }) {
  return (
    <div className="border border-dashed border-border bg-hatch px-6 py-10 text-center">
      <p className="font-mono text-micro font-medium uppercase">{title}</p>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">{description}</p>
      )}
    </div>
  );
}

/** Column headings for the console's data tables: mono, ruled, never bold grey. */
export function RegisterHead({ columns }: { columns: { label: string; align?: 'right' }[] }) {
  return (
    <thead>
      <tr className="border-b border-border">
        {columns.map((column) => (
          <th
            key={column.label}
            scope="col"
            className={cn(
              'am-eyebrow whitespace-nowrap py-2 pr-4 font-medium',
              column.align === 'right' ? 'pl-4 pr-0 text-right' : 'text-left',
            )}
          >
            {column.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}
