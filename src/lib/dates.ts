/**
 * Dev builds can pin "today" to the sample data's date (Sep 30, 2026) so screens
 * match the design canvas. Never set in release builds.
 */
let pinnedToday: string | null = null;

export function pinToday(date: string | null): void {
  pinnedToday = date;
}

/** Today's local calendar date as "YYYY-MM-DD" (what decides month and fiscal year). */
export function today(now?: Date): string {
  if (!now && pinnedToday) return pinnedToday;
  const d = now ?? new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Current UTC timestamp for `*_at` columns. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** "2026-09" for a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** First and last day of a "YYYY-MM" month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Adds days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return today(new Date(y, m - 1, d + days));
}
