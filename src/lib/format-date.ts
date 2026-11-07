import { strings } from '@/i18n/strings';

/** "Aug 3" for dates this year, "Aug 3, 2025" otherwise. Takes a local "YYYY-MM-DD" date. */
export function formatShortDate(date: string, now: Date = new Date()): string {
  const [y, m, d] = date.split('-').map(Number);
  const label = `${strings.dates.months[m - 1]} ${d}`;
  return y === now.getFullYear() ? label : `${label}, ${y}`;
}
