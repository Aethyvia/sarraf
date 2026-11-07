/** Today's local calendar date as "YYYY-MM-DD" (what decides month and fiscal year). */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Current UTC timestamp for `*_at` columns. */
export function nowIso(): string {
  return new Date().toISOString();
}
