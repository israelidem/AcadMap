/** Accessible tab strip used by the planner, performance and admin pages. */

import { cn } from '@/lib/utils';

export interface TabItem {
  value: string;
  label: string;
}

export function Tabs({
  value,
  onChange,
  tabs,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  tabs: TabItem[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Sections"
      className={cn(
        // `am-scroll-x` lets a long tab strip scroll to the screen edge on a
        // phone instead of squeezing the labels.
        'am-scroll-x mb-4 flex gap-0 border-b border-border',

        className,
      )}

    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              // Dividers in a file: the selected one is pulled forward, marked
              // with a violet rule at its foot, and the rest stay filed away.
              'am-focus -mb-px whitespace-nowrap px-3.5 py-2.5 font-mono text-micro font-medium uppercase transition-colors',
              active
                ? 'rounded-t-lg border border-b-2 border-border border-b-brand bg-surface text-brand'
                : 'border border-transparent border-b-border text-muted hover:text-fg',
            )}

          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
