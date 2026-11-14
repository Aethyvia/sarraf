import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { accounts, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso, today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { dec, isDecimalString, rateFromAmounts, toDecimalString, type DecimalString } from '@/lib/money';
import { DataError } from './errors';
import { chargedCurrencyOf, chargesOf, outstandingOf } from './owing';

export type MoneyBackKind = 'refund' | 'reimbursement';

export interface MoneyBackDraft {
  /** The original expense. */
  parentId: string;
  kind: MoneyBackKind;
  /** Where the money arrived; may differ from the original's account (Decided). */
  accountId: string;
  /** What arrived, in that account's currency. */
  amount: DecimalString;
  /** The day it arrived; it counts in that month (Decided Nov 7). Today or earlier. */
  date: string;
  /** In another currency: what it counts as in the original's currency. Required then. */
  countsAs?: DecimalString | null;
  notes?: string | null;
}

/**
 * Got it (reimbursement) or Add refund: a linked row bringing money into an
 * account. It's never income; it lowers the original's category spending.
 * A reimbursement moves the original to Partly back or Reimbursed.
 */
export function addMoneyBack(db: AppDb, draft: MoneyBackDraft, today: string = todayDate()): string {
  if (!isDecimalString(draft.amount) || dec(draft.amount).lte(0)) throw new DataError('invalid_amount', 'Enter an amount above zero');
  if (draft.date > today) throw new DataError('invalid_target', 'Money back is added when it arrives');
  return db.transaction((tx) => {
    const parent = tx.select().from(transactions).where(eq(transactions.id, draft.parentId)).get();
    if (!parent || parent.deletedAt) throw new DataError('not_found', 'No transaction');
    if (parent.kind !== 'expense' || parent.linkType) throw new DataError('invalid_target', 'Money back links to an expense');
    if (draft.kind === 'reimbursement' && !parent.reimbursable) throw new DataError('invalid_target', 'That expense isn’t reimbursable');
    const account = tx.select().from(accounts).where(eq(accounts.id, draft.accountId)).get();
    if (!account) throw new DataError('not_found', 'No account');
    if (account.archivedAt) throw new DataError('archived', 'That account is archived');

    const originalCurrency = chargedCurrencyOf(tx, parent);
    const amount = toDecimalString(dec(draft.amount));
    let countsAs = amount;
    if (account.currency !== originalCurrency) {
      if (!draft.countsAs || !isDecimalString(draft.countsAs) || dec(draft.countsAs).lte(0)) {
        throw new DataError('invalid_amount', 'Say what it counts as in the original currency');
      }
      countsAs = toDecimalString(dec(draft.countsAs));
    }

    // Refunds and reimbursements are limited separately (owner, Nov 15): a shop's refund and a
    // client's reimbursement can both arrive in full. Refunds: up to the expense. Reimbursements:
    // up to the expense and its separate charges, paying the expense first, then the charges.
    const expenseBack = tx
      .select({ c: transactions.countsAsAmount, ch: transactions.chargesBack })
      .from(transactions)
      .where(and(eq(transactions.parentId, parent.id), eq(transactions.linkType, draft.kind), isNull(transactions.deletedAt)))
      .all()
      .reduce((sum, r) => sum.plus(dec(r.c ?? '0')).minus(dec(r.ch ?? '0')), dec('0'));
    const expenseLeft = dec(parent.accountAmount ?? parent.amount).minus(expenseBack);
    const charges = draft.kind === 'reimbursement' ? chargesOf(tx, parent) : null;
    const room = expenseLeft.plus(charges?.left ?? 0);
    if (dec(countsAs).gt(room)) {
      throw new DataError('invalid_amount', draft.kind === 'refund' ? 'A refund can’t be more than what’s left of the original' : 'That’s more than the expense and its charges');
    }
    const over = dec(countsAs).minus(expenseLeft.isNegative() ? dec('0') : expenseLeft);
    const chargesBack = charges && over.gt(0) ? toDecimalString(over) : null;

    const id = newId();
    tx.insert(transactions)
      .values({
        id,
        kind: 'expense',
        date: draft.date,
        status: 'cleared',
        ledgerId: parent.ledgerId,
        accountId: account.id,
        amount,
        currency: account.currency,
        accountAmount: amount,
        parentId: parent.id,
        linkType: draft.kind,
        countsAsAmount: countsAs,
        chargesBack,
        countsAsRate: account.currency !== originalCurrency ? rateFromAmounts(amount, countsAs) : null,
        notes: draft.notes?.trim() || null,
      })
      .run();
    if (draft.kind === 'reimbursement') syncReimbursementStatus(tx, [parent.id]);
    return id;
  });
}

/**
 * Write off (Spec §10): nothing more is coming back; the rest stays your own
 * spending. Money already back stays linked.
 */
export function writeOff(db: AppDb, id: string): void {
  db.transaction((tx) => {
    const t = tx.select().from(transactions).where(eq(transactions.id, id)).get();
    if (!t) throw new DataError('not_found', 'No transaction');
    if (t.reimbursementStatus !== 'awaiting' && t.reimbursementStatus !== 'partly_back') throw new DataError('invalid_target', 'Nothing is waiting');
    tx.update(transactions).set({ reimbursementStatus: 'written_off', updatedAt: nowIso() }).where(eq(transactions.id, id)).run();
  });
}

/**
 * Re-derives each reimbursable expense's status from its linked money back
 * (Schema: sum of counts-as vs the expense amount). A written-off expense
 * stays written off unless it's now paid back in full.
 */
export function syncReimbursementStatus(db: AppDb, parentIds: string[]): void {
  if (!parentIds.length) return;
  const parents = db
    .select()
    .from(transactions)
    .where(and(inArray(transactions.id, parentIds), eq(transactions.reimbursable, true)))
    .all();
  for (const p of parents) {
    const { outstanding } = outstandingOf(db, p);
    // Expected: the expense and its separate charges (owner, Nov 15).
    const charged = dec(p.accountAmount ?? p.amount).plus(chargesOf(db, p).total);
    const status =
      outstanding.lte(0) ? 'reimbursed' : p.reimbursementStatus === 'written_off' ? 'written_off' : outstanding.lt(charged) ? 'partly_back' : 'awaiting';
    if (status !== p.reimbursementStatus) {
      db.update(transactions).set({ reimbursementStatus: status, updatedAt: nowIso() }).where(eq(transactions.id, p.id)).run();
    }
  }
}

/** The parents of any linked rows among these ids (to re-sync after a delete or restore). */
export function parentsOf(db: AppDb, ids: string[]): string[] {
  if (!ids.length) return [];
  const rows = db
    .select({ parentId: transactions.parentId })
    .from(transactions)
    .where(and(inArray(transactions.id, ids), isNotNull(transactions.parentId)))
    .all();
  return [...new Set(rows.map((r) => r.parentId!))];
}

/** What can still be refunded on an expense, in the currency it was charged in. */
export function refundableLeft(db: AppDb, parentId: string): { currency: string; amount: DecimalString } {
  const parent = db.select().from(transactions).where(eq(transactions.id, parentId)).get();
  if (!parent) throw new DataError('not_found', 'No transaction');
  // Refunds only: a reimbursement is limited on its own (owner, Nov 15).
  const refunded = moneyBackOf(db, parentId)
    .filter((r) => r.linkType === 'refund')
    .reduce((sum, r) => sum.plus(dec(r.countsAsAmount ?? '0')), dec('0'));
  return { currency: chargedCurrencyOf(db, parent), amount: toDecimalString(dec(parent.accountAmount ?? parent.amount).minus(refunded)) };
}

/** Linked money back on an expense, oldest first. */
export function moneyBackOf(db: AppDb, parentId: string) {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.parentId, parentId), isNull(transactions.deletedAt)))
    .orderBy(transactions.date)
    .all();
}
