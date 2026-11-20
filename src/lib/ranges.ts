import { addDays, monthOf, monthRange } from './dates';

/**
 * The preset date ranges offered by Analytics and What converting cost you.
 * Both "This year" (from Jan 1) and "This fiscal year" (from the fiscal year's
 * start) are offered; when the fiscal year is Jan – Dec they'd be the same, so
 * only "This year" shows (owner, Nov 20 — replaces the Settings switch).
 */
export type RangeKey = 'month' | 'last' | 'three' | 'year' | 'fiscal';

/** Whether "This fiscal year" is offered: only when it differs from the calendar year. */
export function hasFiscalYear(fiscalStart: number): boolean {
  return fiscalStart >= 2 && fiscalStart <= 12;
}

/** The presets to show, in order. */
export function rangeKeys(fiscalStart: number): RangeKey[] {
  return hasFiscalYear(fiscalStart) ? ['month', 'last', 'three', 'year', 'fiscal'] : ['month', 'last', 'three', 'year'];
}

/** Jan 1 to today. */
export function thisYearRange(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

/** From the start of the fiscal year that contains today, to today. */
export function thisFiscalYearRange(today: string, fiscalStart: number): { from: string; to: string } {
  if (!hasFiscalYear(fiscalStart)) return thisYearRange(today);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const startYear = m >= fiscalStart ? y : y - 1;
  return { from: `${startYear}-${String(fiscalStart).padStart(2, '0')}-01`, to: today };
}

export function rangeFor(key: RangeKey, today: string, fiscalStart: number): { from: string; to: string } {
  const month = monthOf(today);
  const [y, m] = today.split('-').map(Number);
  switch (key) {
    case 'month':
      return { from: monthRange(month).from, to: today };
    case 'last':
      return monthRange(monthOf(addDays(monthRange(month).from, -1)));
    case 'three': {
      const total = y * 12 + (m - 1) - 2;
      return { from: `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`, to: today };
    }
    case 'year':
      return thisYearRange(today);
    case 'fiscal':
      return thisFiscalYearRange(today, fiscalStart);
  }
}
