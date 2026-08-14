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
        'am-scroll-x mb-4 flex gap-1 border-b border-border',
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
              'am-focus whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium',
              active
                ? 'border-b-2 border-brand text-brand'
                : 'border-b-2 border-transparent text-muted hover:text-fg',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
