import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { accounts, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso, today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { dec, isDecimalString, rateFromAmounts, toDecimalString, type DecimalString } from '@/lib/money';
import { DataError } from './errors';
import { chargedCurrencyOf, outstandingOf } from './owing';

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
    const charged = dec(p.accountAmount ?? p.amount);
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

/** Linked money back on an expense, oldest first. */
export function moneyBackOf(db: AppDb, parentId: string) {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.parentId, parentId), isNull(transactions.deletedAt)))
    .orderBy(transactions.date)
    .all();
}
