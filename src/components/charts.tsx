/** Recharts wrappers that inherit the theme through CSS variables. */

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TermPerformance } from '@shared/gpa';

/*
 * Axis figures are monospaced, as every other number in AcadMap is. Recharts
 * renders SVG text, which does not inherit the app's font stack, so the family
 * has to be named here rather than left to CSS.
 */
const TICK_FONT = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";


export function GpaHistoryChart({
  history,
  scale,
  showCumulative = true,
  height = 240,
}: {
  history: TermPerformance[];
  scale: number;
  showCumulative?: boolean;
  height?: number;
}) {
  const data = history.map((entry) => ({
    name: entry.label,
    gpa: Number(entry.gpa.toFixed(2)),
    cgpa: Number(entry.cumulativeGpa.toFixed(2)),
  }));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          {/* Ruled like the sheet the rest of the app is printed on: horizontal
              lines only, so the eye reads values rather than a grid. */}
          <CartesianGrid vertical={false} stroke="rgb(var(--am-rule))" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: 'rgb(var(--am-muted))', fontFamily: TICK_FONT }}
            stroke="rgb(var(--am-border))"
          />
          <YAxis
            domain={[0, Math.ceil(scale)]}
            tick={{ fontSize: 11, fill: 'rgb(var(--am-muted))', fontFamily: TICK_FONT }}
            stroke="rgb(var(--am-border))"
          />
          <Tooltip
            cursor={{ stroke: 'rgb(var(--am-brand))', strokeWidth: 1 }}
            contentStyle={{
              background: 'rgb(var(--am-surface))',
              border: '1px solid rgb(var(--am-border))',
              borderRadius: 4,
              color: 'rgb(var(--am-fg))',
              fontSize: 12,
              fontFamily: TICK_FONT,
            }}
          />

          <Line
            type="monotone"
            dataKey="gpa"
            name="Term GPA"
            stroke="rgb(var(--am-brand))"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          {showCumulative && (
            <Line
              type="monotone"
              dataKey="cgpa"
              name="CGPA"
              stroke="rgb(var(--am-accent))"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 3 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
