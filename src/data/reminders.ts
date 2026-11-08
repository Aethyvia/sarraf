import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { accounts, budgets, categories, deviceState, ledgers, recurringItems, settings, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { strings } from '@/i18n/strings';
import { addDays } from '@/lib/dates';
import { dec, formatExact, type NumberFormat } from '@/lib/money';
import { budgetPeriod, budgetStatuses } from './budgets';
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

  // Backups failing for 3 days (only while backup is on and this is still the backup phone).
  if (set.notifyBackupProblems) {
    const state = db.select().from(deviceState).where(eq(deviceState.id, 1)).get();
    if (state?.backupEnabled && !state.backupMovedAt && state.backupFailingSince) {
      add({
        key: `backup-failing:${state.backupFailingSince}`,
        at: `${addDays(state.backupFailingSince.slice(0, 10), 3)}T${OTHER_TIME}`,
        title: s.backupFailing,
        body: s.backupFailingBody,
        route: '/backup',
      });
    }
  }

  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** A budget alert to show now, and the mark that stops it repeating this period. */
export interface BudgetAlert {
  budgetId: string;
  mark: string;
  title: string;
  body: string;
  route: string;
}

/**
 * Budget alerts due now (Spec §15, Notifications): once per budget per period
 * at 80% and again at 100%, each switchable in Settings and on the budget.
 * Jumping straight past 100% sends only the 100% one. Every ledger counts.
 */
export function budgetAlertsDue(db: AppDb, asOf: string): BudgetAlert[] {
  const s = strings.notifications;
  const set = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!set || (!set.notifyBudget80 && !set.notifyBudget100)) return [];
  const cats = new Map(db.select({ id: categories.id, name: categories.name }).from(categories).all().map((c) => [c.id, c.name]));
  const money = (value: string, currency: string) => (set.hideAmounts ? null : formatExact(value, currency, { numberFormat: set.numberFormat as NumberFormat }));
  const out: BudgetAlert[] = [];
  for (const ledger of db.select().from(ledgers).all()) {
    for (const st of budgetStatuses(db, ledger.id, asOf)) {
      const b = st.budget;
      const level = st.percent >= 100 && set.notifyBudget100 && b.notify100 ? 100 : st.percent >= 80 && set.notifyBudget80 && b.notify80 ? 80 : null;
      if (!level) continue;
      const start = budgetPeriod(b.period, asOf).from;
      const [doneStart, doneLevel] = (b.alerted ?? '').split(':');
      if (doneStart === start && Number(doneLevel) >= level) continue;
      const name = b.categoryId ? (cats.get(b.categoryId) ?? '') : strings.budgets.allSpending;
      out.push({
        budgetId: b.id,
        mark: `${start}:${level}`,
        title: level === 100 ? s.budgetUsedUp(name) : s.budgetNearly(name),
        body: s.budgetBody(ledger.name, money(st.spent, b.currency), money(b.amount, b.currency), money(dec(st.left).abs().toString(), b.currency), st.over),
        route: `/budgets/${b.id}`,
      });
    }
  }
  return out;
}

/** Records that a budget's alert went out, so it isn't sent again this period. */
export function markBudgetAlerted(db: AppDb, budgetId: string, mark: string): void {
  db.update(budgets).set({ alerted: mark }).where(eq(budgets.id, budgetId)).run();
}
