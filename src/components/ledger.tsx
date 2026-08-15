/**
 * The unit ledger — AcadMap's signature reading of a student's record.
 *
 * A CGPA is a unit-weighted average, and that weighting is the one thing a plain
 * number hides: a 5.0 in a one-unit elective and a 2.0 in a six-unit core course
 * do not carry the same freight. So the ledger draws the arithmetic itself.
 *
 *   width  of a column = the course's unit load
 *   height of a column = the grade point earned, against the scale
 *   the dashed line     = the CGPA those columns average out to
 *
 * Read left to right it is a term's worth of work; read as a whole it shows
 * exactly which courses are holding the average up and which are pulling it
 * down. The strip is decorative to assistive technology — the same figures are
 * published underneath it as a table.
 */

import { cn } from '@/lib/utils';

export interface LedgerEntry {
  code: string;
  name: string;
  units: number;
  gradePoint: number;
  gradeName: string;
}

/** Grade bands are inked, not tinted at random: violet earns, ochre warns. */
function bandClass(ratio: number): string {
  if (ratio >= 0.8) return 'bg-brand';
  if (ratio >= 0.6) return 'bg-brand/65';
  if (ratio >= 0.4) return 'bg-warning/75';
  return 'bg-danger/70';
}

export function UnitLedger({
  entries,
  scale,
  average,
  averageLabel = 'CGPA',
  className,
}: {
  entries: LedgerEntry[];
  scale: number;
  average: number;
  averageLabel?: string;
  className?: string;
}) {
  const safeScale = scale > 0 ? scale : 5;
  const totalUnits = entries.reduce((sum, entry) => sum + entry.units, 0);
  const averageRatio = Math.max(0, Math.min(1, average / safeScale));

  if (entries.length === 0 || totalUnits === 0) return null;

  return (
    <figure className={cn('m-0', className)}>
      <div className="relative">
        {/* The scale's own gridlines: the sheet this is drawn on. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((line) => (
            <span key={line} className="block h-px w-full bg-rule" />
          ))}
        </div>

        <div aria-hidden className="relative flex h-36 items-end gap-px sm:h-44">
          {entries.map((entry, index) => {
            const ratio = Math.max(0, Math.min(1, entry.gradePoint / safeScale));
            return (
              <div
                key={`${entry.code}-${index}`}
                className="relative flex h-full min-w-[10px] flex-col justify-end"
                style={{ flexGrow: entry.units, flexBasis: 0 }}
                title={`${entry.code} · ${entry.units} unit${entry.units === 1 ? '' : 's'} · ${entry.gradeName} (${entry.gradePoint})`}
              >
                <div
                  className={cn('w-full origin-bottom animate-tally', bandClass(ratio))}
                  style={{
                    height: `${Math.max(ratio * 100, 3)}%`,
                    animationDelay: `${Math.min(index * 45, 400)}ms`,
                  }}
                />
              </div>
            );
          })}

          {/* Where the columns average out. The label sits on the line itself. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-accent"
            style={{ bottom: `${averageRatio * 100}%` }}
          >
            <span className="absolute -top-2.5 right-0 rounded-sm border border-accent/50 bg-surface px-1.5 py-px font-mono text-[10px] font-medium uppercase text-accent">
              {averageLabel} {average.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Column feet: the codes, printed where they fit. */}
      <div aria-hidden className="mt-1.5 flex gap-px border-t border-border pt-1.5">
        {entries.map((entry, index) => (
          <span
            key={`${entry.code}-foot-${index}`}
            className="min-w-[10px] truncate text-center font-mono text-[10px] uppercase text-muted"
            style={{ flexGrow: entry.units, flexBasis: 0 }}
          >
            {entry.code}
          </span>
        ))}
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase text-muted">
        <span>Width = units</span>
        <span>Height = grade point of {safeScale}</span>
        <span className="text-accent">Dashes = {averageLabel}</span>
        <span className="ml-auto">
          {totalUnits} unit{totalUnits === 1 ? '' : 's'} plotted
        </span>
      </figcaption>

      {/* The same record, in the form assistive technology can read. */}
      <table className="sr-only">
        <caption>Courses by unit load and grade point</caption>
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Units</th>
            <th scope="col">Grade</th>
            <th scope="col">Grade point</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={`${entry.code}-row-${index}`}>
              <th scope="row">{entry.name || entry.code}</th>
              <td>{entry.units}</td>
              <td>{entry.gradeName}</td>
              <td>{entry.gradePoint}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * The stamped figure: one headline number impressed on the sheet. Only one of
 * these belongs on a screen, which is why it is a component and not a utility.
 */
export function RecordPlate({
  label,
  value,
  outOf,
  note,
  className,
}: {
  label: string;
  value: string;
  outOf?: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn('am-plate animate-stamp', className)}>
      <p className="am-eyebrow text-brand/80">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="tabular text-5xl font-semibold leading-none text-brand">{value}</span>
        {outOf && <span className="tabular text-sm text-brand/70">/ {outOf}</span>}
      </p>
      {note && <p className="mt-2 text-xs text-brand/80">{note}</p>}
    </div>
  );
}
