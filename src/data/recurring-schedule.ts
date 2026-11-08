import { eq } from 'drizzle-orm';

import { recurringItems } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { addDays, nowIso } from '@/lib/dates';
import type { DecimalString } from '@/lib/money';

export type RecurringItem = typeof recurringItems.$inferSelect;

/**
 * How an item repeats. `day` is the day of the month (monthly, yearly) or the
 * weekday 0–6, Sunday first (weekly). Days past a month's end fall on its last day.
 */
export interface RepeatRule {
  freq: 'weekly' | 'monthly' | 'yearly';
  interval: number;
  day: number;
  /** Yearly only, 1–12. */
  month?: number;
}

export const SHOW_ON_HOME_DAYS = [0, 1, 3, 7] as const;

// ── Dates ──

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** The rule's day in a given month, kept inside the month (31 → 30 or 28/29). */
function dayIn(y: number, m: number, day: number): string {
  return iso(y, m, Math.min(day, daysIn(y, m)));
}
function weekday(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The first due date on or after `from`. */
export function firstDueOnOrAfter(rule: RepeatRule, from: string): string {
  const [y, m] = parts(from);
  switch (rule.freq) {
    case 'weekly':
      return addDays(from, (rule.day - weekday(from) + 7) % 7);
    case 'monthly': {
      const here = dayIn(y, m, rule.day);
      if (here >= from) return here;
      const next = m === 12 ? [y + 1, 1] : [y, m + 1];
      return dayIn(next[0], next[1], rule.day);
    }
    case 'yearly': {
      const month = rule.month ?? m;
      const here = dayIn(y, month, rule.day);
      return here >= from ? here : dayIn(y + 1, month, rule.day);
    }
  }
}

/** The due date after `due`. */
export function nextDue(rule: RepeatRule, due: string): string {
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  const [y, m] = parts(due);
  switch (rule.freq) {
    case 'weekly':
      return addDays(due, 7 * interval);
    case 'monthly': {
      const total = m - 1 + interval;
      return dayIn(y + Math.floor(total / 12), (total % 12) + 1, rule.day);
    }
    case 'yearly':
      return dayIn(y + interval, rule.month ?? m, rule.day);
  }
}

/** True once an item has passed its end (a date, or a number of times). */
export function hasEnded(item: Pick<RecurringItem, 'endsOn' | 'maxOccurrences' | 'occurrences' | 'nextDueDate'>): boolean {
  if (item.endsOn && item.nextDueDate > item.endsOn) return true;
  return item.maxOccurrences !== null && item.occurrences >= item.maxOccurrences;
}

/** The day an item starts showing on Home. */
export function showFrom(item: Pick<RecurringItem, 'nextDueDate' | 'showOnHomeDays'>): string {
  return addDays(item.nextDueDate, -item.showOnHomeDays);
}

/** Moves an item past a handled due date; it stops once it has ended. */
export function advance(db: AppDb, item: RecurringItem, lastAmount?: DecimalString | null): void {
  const rule = item.repeatRule as RepeatRule;
  const moved = { ...item, occurrences: item.occurrences + 1, nextDueDate: nextDue(rule, item.nextDueDate) };
  db.update(recurringItems)
    .set({
      occurrences: moved.occurrences,
      nextDueDate: moved.nextDueDate,
      active: !hasEnded(moved),
      ...(lastAmount ? { lastAmount } : {}),
      updatedAt: nowIso(),
    })
    .where(eq(recurringItems.id, item.id))
    .run();
}

/**
 * Called when a transaction for an item's current due date is saved (Pay / Add
 * from Home or Needs review): the item moves on and remembers the amount.
 */
export function noteRecurringHandled(db: AppDb, recurringId: string, dueDate: string, amount: DecimalString): void {
  const item = db.select().from(recurringItems).where(eq(recurringItems.id, recurringId)).get();
  if (!item || item.nextDueDate !== dueDate) return;
  advance(db, item, amount);
}

