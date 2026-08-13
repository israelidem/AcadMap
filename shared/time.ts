import type { DateStr, TimeStr, Weekday } from './types';

export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function toDateStr(date: Date): DateStr {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parses `YYYY-MM-DD` as a local date (avoids UTC shifting bugs). */
export function fromDateStr(value: DateStr): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function todayStr(now: Date = new Date()): DateStr {
  return toDateStr(now);
}

export function addDays(value: DateStr, days: number): DateStr {
  const date = fromDateStr(value);
  date.setDate(date.getDate() + days);
  return toDateStr(date);
}

export function daysBetween(from: DateStr, to: DateStr): number {
  const ms = fromDateStr(to).getTime() - fromDateStr(from).getTime();
  return Math.round(ms / 86_400_000);
}

export function weekdayOf(value: DateStr): Weekday {
  return fromDateStr(value).getDay() as Weekday;
}

export function toMinutes(time: TimeStr): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function toTimeStr(minutes: number): TimeStr {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h = `${Math.floor(clamped / 60)}`.padStart(2, '0');
  const m = `${clamped % 60}`.padStart(2, '0');
  return `${h}:${m}`;
}

export function formatTime12h(time: TimeStr): string {
  const total = toMinutes(time);
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${`${m}`.padStart(2, '0')} ${suffix}`;
}

export function formatDateLong(value: DateStr): string {
  return fromDateStr(value).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
