import { and, eq } from 'drizzle-orm';

import { accounts, categories, recurringItems, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { addDays, nowIso, today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { dec, isCurrencyCode, isDecimalString, toDecimalString, type DecimalString } from '@/lib/money';
import { DataError, requireName } from './errors';
import { saveTransaction, type TransactionDraft, type TransactionRow } from './transactions';

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

// ── Create, edit, delete ──

export interface RecurringInput {
  kind: 'expense' | 'income' | 'transfer';
  amountType: 'same' | 'varies';
  name: string;
  /** Same amount only. In the account's currency (transfers: the From account's). */
  amount?: DecimalString | null;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  ledgerId?: string | null;
  referencePersonId?: string | null;
  rule: RepeatRule;
  /** The first due date is the rule's first date on or after this (default today). */
  startOn?: string;
  showOnHomeDays: number;
  /** Same amount only. Off = "Remind me, don't auto-add". */
  autoAdd: boolean;
  endsOn?: string | null;
  maxOccurrences?: number | null;
}

function check(db: AppDb, input: RecurringInput): { name: string; currency: string } {
  const name = requireName(input.name);
  const account = db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
  if (!account) throw new DataError('not_found', 'No account');
  if (input.amountType === 'same' && (!input.amount || !isDecimalString(input.amount) || dec(input.amount).lte(0))) {
    throw new DataError('invalid_amount', 'Enter an amount above zero');
  }
  if (input.kind === 'transfer') {
    if (!input.toAccountId || input.toAccountId === input.accountId) throw new DataError('invalid_target', 'Pick a different To account');
    if (!db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, input.toAccountId)).get()) throw new DataError('not_found', 'No account');
  }
  if (input.categoryId) {
    const cat = db.select().from(categories).where(eq(categories.id, input.categoryId)).get();
    if (!cat) throw new DataError('not_found', 'No category');
    if (input.kind === 'transfer' || cat.kind !== input.kind) throw new DataError('category_kind_mismatch', 'That category is for the other kind');
  }
  if (!SHOW_ON_HOME_DAYS.includes(input.showOnHomeDays as 0)) throw new DataError('invalid_target', 'Show on Home is 0, 1, 3 or 7 days before');
  if (input.maxOccurrences !== null && input.maxOccurrences !== undefined && input.maxOccurrences < 1) throw new DataError('invalid_target', 'At least once');
  if (!isCurrencyCode(account.currency)) throw new DataError('invalid_currency', 'Unknown currency');
  return { name, currency: account.currency };
}

function values(db: AppDb, input: RecurringInput, today: string) {
  const { name, currency } = check(db, input);
  const same = input.amountType === 'same';
  return {
    kind: input.kind,
    amountType: input.amountType,
    name,
    amount: same ? toDecimalString(dec(input.amount!)) : null,
    currency,
    accountId: input.accountId,
    toAccountId: input.kind === 'transfer' ? input.toAccountId! : null,
    categoryId: input.kind === 'transfer' ? null : (input.categoryId ?? null),
    ledgerId: input.ledgerId ?? null,
    referencePersonId: input.referencePersonId ?? null,
    repeatRule: input.rule,
    nextDueDate: firstDueOnOrAfter(input.rule, input.startOn ?? today),
    showOnHomeDays: input.showOnHomeDays,
    // A bill is never added automatically (Decided).
    autoAdd: same && input.autoAdd,
    endsOn: input.endsOn ?? null,
    maxOccurrences: input.maxOccurrences ?? null,
  };
}

export function createRecurring(db: AppDb, input: RecurringInput, today: string = todayDate()): string {
  const id = newId();
  db.insert(recurringItems).values({ id, ...values(db, input, today) }).run();
  return id;
}

/**
 * Edits an item. Past transactions it made stay as they are. The next due date
 * is worked out again only when the schedule changed.
 */
export function updateRecurring(db: AppDb, id: string, input: RecurringInput, today: string = todayDate()): void {
  const existing = db.select().from(recurringItems).where(eq(recurringItems.id, id)).get();
  if (!existing) throw new DataError('not_found', 'No recurring item');
  const next = values(db, input, today);
  const sameRule = JSON.stringify(existing.repeatRule) === JSON.stringify(input.rule) && !input.startOn;
  db.update(recurringItems)
    .set({ ...next, nextDueDate: sameRule ? existing.nextDueDate : next.nextDueDate, active: true, updatedAt: nowIso() })
    .where(eq(recurringItems.id, id))
    .run();
}

/** Deletes an item. Transactions it already made stay, unlinked. */
export function deleteRecurring(db: AppDb, id: string): void {
  db.transaction((tx) => {
    tx.update(transactions).set({ recurringId: null, updatedAt: nowIso() }).where(eq(transactions.recurringId, id)).run();
    tx.delete(recurringItems).where(eq(recurringItems.id, id)).run();
  });
}

// ── Handling a due date ──

/** Moves an item past a handled due date; it stops once it has ended. */
function advance(db: AppDb, item: RecurringItem, lastAmount?: DecimalString | null): void {
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

/** Skip this one: nothing is added and the next due date stays scheduled. */
export function skipRecurring(db: AppDb, id: string): void {
  const item = db.select().from(recurringItems).where(eq(recurringItems.id, id)).get();
  if (!item) throw new DataError('not_found', 'No recurring item');
  advance(db, item);
}

/** What Pay / Add pre-fills from an item for its current due date. */
export function recurringDraft(item: RecurringItem, date: string): TransactionDraft {
  return {
    kind: item.kind,
    date,
    status: 'cleared',
    ledgerId: item.ledgerId,
    categoryId: item.categoryId,
    referencePersonId: item.referencePersonId,
    accountId: item.accountId,
    toAccountId: item.toAccountId,
    amount: item.amount ?? item.lastAmount ?? '0',
    currency: item.currency,
    recurringId: item.id,
    recurringDueDate: item.nextDueDate,
  };
}

/** True when Paid can add it in one tap (same amount, and a transfer needs no rate). */
export function canPayInOneTap(db: AppDb, item: RecurringItem): boolean {
  if (item.amountType !== 'same') return false;
  if (item.kind !== 'transfer') return true;
  const to = db.select({ c: accounts.currency }).from(accounts).where(eq(accounts.id, item.toAccountId!)).get();
  return to?.c === item.currency;
}

/** Paid / Received from Home: adds it as Cleared today. Confirmed by you, so it doesn't need review. */
export function payRecurring(db: AppDb, id: string, today: string = todayDate()): string {
  const item = db.select().from(recurringItems).where(eq(recurringItems.id, id)).get();
  if (!item) throw new DataError('not_found', 'No recurring item');
  if (!canPayInOneTap(db, item)) throw new DataError('invalid_amount', 'Enter the amount first');
  return saveTransaction(db, recurringDraft(item, today), { today }).id;
}

/**
 * Missed auto-adds (Decided Nov 7): on app open, every auto-add item gets one
 * transaction per due date up to today, with its real date, never twice
 * (keyed by item + due date). Expenses and income land Pending, transfers In
 * transit, all marked auto-added. Returns what was added.
 */
export function backfillRecurring(db: AppDb, today: string = todayDate()): TransactionRow[] {
  const added: string[] = [];
  db.transaction((tx) => {
    const items = tx
      .select()
      .from(recurringItems)
      .where(and(eq(recurringItems.active, true), eq(recurringItems.autoAdd, true), eq(recurringItems.amountType, 'same')))
      .all();
    for (let item of items) {
      let guard = 0;
      while (item.nextDueDate <= today && !hasEnded(item) && guard++ < 1000) {
        const due = item.nextDueDate;
        const exists = tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.recurringId, item.id), eq(transactions.recurringDueDate, due)))
          .get();
        if (!exists) added.push(addOne(tx, item, due, today));
        advance(tx, item);
        item = tx.select().from(recurringItems).where(eq(recurringItems.id, item.id)).get()!;
      }
    }
  });
  return rowsById(db, added);
}

function rowsById(db: AppDb, ids: string[]): TransactionRow[] {
  return ids.map((id) => db.select().from(transactions).where(eq(transactions.id, id)).get()!).filter(Boolean);
}

/** One auto-added transaction for a due date. */
function addOne(db: AppDb, item: RecurringItem, due: string, today: string): string {
  const base = { ...recurringDraft(item, due), autoAdded: true };
  if (item.kind !== 'transfer') return saveTransaction(db, { ...base, status: 'pending' }, { today }).id;
  if (canPayInOneTap(db, item)) return saveTransaction(db, { ...base, status: 'in_transit' }, { today }).id;
  // Between currencies: what arrives is filled in when it's confirmed (the rate changes).
  const id = newId();
  db.insert(transactions)
    .values({
      id,
      kind: 'transfer',
      date: due,
      status: 'in_transit',
      ledgerId: item.ledgerId,
      referencePersonId: item.referencePersonId,
      accountId: item.accountId,
      toAccountId: item.toAccountId,
      amount: item.amount!,
      currency: item.currency,
      accountAmount: item.amount!,
      recurringId: item.id,
      recurringDueDate: due,
      autoAdded: true,
    })
    .run();
  return id;
}

/** Items on Home's Recurring section: from their Show on Home day until handled. */
export function recurringOnHome(db: AppDb, today: string = todayDate()): { item: RecurringItem; due: string; overdue: boolean }[] {
  return db
    .select()
    .from(recurringItems)
    .where(eq(recurringItems.active, true))
    .orderBy(recurringItems.nextDueDate)
    .all()
    .filter((item) => !hasEnded(item) && showFrom(item) <= today)
    .map((item) => ({ item, due: item.nextDueDate, overdue: item.nextDueDate < today }));
}

/** "Remind me" items whose date has come: they wait in Needs review too (Decided Nov 7). */
export function remindersDue(db: AppDb, today: string = todayDate()): RecurringItem[] {
  return db
    .select()
    .from(recurringItems)
    .where(and(eq(recurringItems.active, true), eq(recurringItems.autoAdd, false), eq(recurringItems.amountType, 'same')))
    .all()
    .filter((item) => !hasEnded(item) && item.nextDueDate <= today);
}

