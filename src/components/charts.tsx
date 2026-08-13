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
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--am-border))" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12, fill: 'rgb(var(--am-muted))' }}
            stroke="rgb(var(--am-border))"
          />
          <YAxis
            domain={[0, Math.ceil(scale)]}
            tick={{ fontSize: 12, fill: 'rgb(var(--am-muted))' }}
            stroke="rgb(var(--am-border))"
          />
          <Tooltip
            contentStyle={{
              background: 'rgb(var(--am-surface))',
              border: '1px solid rgb(var(--am-border))',
              borderRadius: 12,
              color: 'rgb(var(--am-fg))',
              fontSize: 13,
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
