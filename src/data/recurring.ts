import { and, eq } from 'drizzle-orm';

import { accounts, categories, recurringItems, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso, today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { dec, isCurrencyCode, isDecimalString, toDecimalString, type DecimalString } from '@/lib/money';
import { DataError, requireName } from './errors';
import {
  advance,
  firstDueOnOrAfter,
  hasEnded,
  showFrom,
  SHOW_ON_HOME_DAYS,
  type RecurringItem,
  type RepeatRule,
} from './recurring-schedule';
import { saveTransaction, type TransactionDraft, type TransactionRow } from './transactions';

export { firstDueOnOrAfter, hasEnded, nextDue, noteRecurringHandled, showFrom, SHOW_ON_HOME_DAYS } from './recurring-schedule';
export type { RecurringItem, RepeatRule } from './recurring-schedule';

// ── Create, edit, delete ──

export interface RecurringInput {
  kind: 'expense' | 'income' | 'transfer';
  amountType: 'same' | 'varies';
  name: string;
  /** Same amount only, in `currency`. */
  amount?: DecimalString | null;
  /**
   * Expense / income: the amount's currency, default the account's. In another
   * currency, what the account was charged is confirmed each time it's due, so
   * it never auto-adds (Owner, Nov 12). Transfers: always the From account's.
   */
  currency?: string | null;
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

function check(db: AppDb, input: RecurringInput): { name: string; currency: string; accountCurrency: string } {
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
  const currency = input.kind !== 'transfer' && input.currency ? input.currency : account.currency;
  if (!isCurrencyCode(currency)) throw new DataError('invalid_currency', 'Unknown currency');
  return { name, currency, accountCurrency: account.currency };
}

function values(db: AppDb, input: RecurringInput, today: string) {
  const { name, currency, accountCurrency } = check(db, input);
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
    // A bill is never added automatically (Decided); nor is one in another currency than its account (Owner, Nov 12).
    autoAdd: same && input.autoAdd && currency === accountCurrency,
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
    // The item's name becomes the note, so lists show "Netflix", not just its category.
    notes: item.name,
    recurringId: item.id,
    recurringDueDate: item.nextDueDate,
  };
}

/** True when Paid can add it in one tap: same amount, and no rate needed (same currency as the account it lands in). */
export function canPayInOneTap(db: AppDb, item: RecurringItem): boolean {
  if (item.amountType !== 'same') return false;
  const landsIn = item.kind === 'transfer' ? item.toAccountId! : item.accountId;
  if (!landsIn) return false;
  const account = db.select({ c: accounts.currency }).from(accounts).where(eq(accounts.id, landsIn)).get();
  return account?.c === item.currency;
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

