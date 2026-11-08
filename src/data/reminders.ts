import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { accounts, recurringItems, settings, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { strings } from '@/i18n/strings';
import { addDays } from '@/lib/dates';
import { formatExact, type NumberFormat } from '@/lib/money';
import { hasEnded, showFrom } from './recurring-schedule';

/** A phone notification to schedule. `at` is local time, "YYYY-MM-DDTHH:MM". */
export interface PlannedNotification {
  key: string;
  at: string;
  title: string;
  body: string;
  /** The screen a tap opens. */
  route: string;
}

/** Recurring reminders go out at 8:30 on the Show on Home day; the others at 9:00 (NotificationSettings board). */
const RECURRING_TIME = '08:30';
const OTHER_TIME = '09:00';
/** How far ahead notifications are scheduled; they're re-planned on every app open and data change. */
export const PLAN_DAYS = 30;
/** Transfers still in transit are mentioned after this many days. */
export const IN_TRANSIT_AFTER_DAYS = 3;

/**
 * The notifications Sarraf should have scheduled (Spec, Ideas added Nov 7),
 * each only when its setting is on, never in the past, and never with amounts
 * while Hide amounts is on. Budgets and backup arrive with their own layers.
 */
export function planNotifications(db: AppDb, now: { date: string; time: string }): PlannedNotification[] {
  const s = strings.notifications;
  const set = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!set) return [];
  const until = addDays(now.date, PLAN_DAYS);
  const nowStamp = `${now.date}T${now.time}`;
  const names = new Map(db.select({ id: accounts.id, name: accounts.name, c: accounts.currency }).from(accounts).all().map((a) => [a.id, a]));
  const money = (value: string, currency: string) => (set.hideAmounts ? null : formatExact(value, currency, { numberFormat: set.numberFormat as NumberFormat }));
  const out: PlannedNotification[] = [];
  const add = (n: PlannedNotification) => {
    if (n.at > nowStamp && n.at.slice(0, 10) <= until) out.push(n);
  };

  if (set.notifyRecurringDue) {
    for (const item of db.select().from(recurringItems).where(eq(recurringItems.active, true)).all()) {
      if (hasEnded(item)) continue;
      const day = showFrom(item);
      const account = item.accountId ? names.get(item.accountId)?.name : undefined;
      const amount = item.amount ? money(item.amount, item.currency) : null;
      add({
        key: `recurring:${item.id}:${item.nextDueDate}`,
        at: `${day}T${RECURRING_TIME}`,
        title: s.recurringDue(item.name, item.showOnHomeDays),
        body: s.recurringBody(amount, account ?? '', item.kind, item.amountType === 'varies'),
        route: '/',
      });
    }
  }

  if (set.notifyExpectedLate) {
    const pending = db
      .select()
      .from(transactions)
      .where(and(isNull(transactions.deletedAt), eq(transactions.status, 'pending'), isNotNull(transactions.expectedDate)))
      .all();
    for (const t of pending) {
      const account = t.accountId ? names.get(t.accountId)?.name : undefined;
      add({
        key: `late:${t.id}:${t.expectedDate}`,
        at: `${addDays(t.expectedDate!, 1)}T${OTHER_TIME}`,
        title: s.expectedLate(t.notes?.split('\n')[0] ?? strings.add.kinds[t.kind as 'income']),
        body: s.expectedLateBody(money(t.accountAmount ?? t.amount, t.currency), account ?? ''),
        route: '/review',
      });
    }
  }

  if (set.notifyInTransit) {
    const moving = db
      .select()
      .from(transactions)
      .where(and(isNull(transactions.deletedAt), inArray(transactions.status, ['in_transit']), eq(transactions.kind, 'transfer')))
      .all();
    for (const t of moving) {
      const from = t.accountId ? (names.get(t.accountId)?.name ?? '') : '';
      const to = t.toAccountId ? (names.get(t.toAccountId)?.name ?? '') : '';
      add({
        key: `transit:${t.id}`,
        at: `${addDays(t.date, IN_TRANSIT_AFTER_DAYS)}T${OTHER_TIME}`,
        title: s.inTransit,
        body: s.inTransitBody(from, to, IN_TRANSIT_AFTER_DAYS),
        route: '/review',
      });
    }
  }

  return out.sort((a, b) => a.at.localeCompare(b.at));
}
