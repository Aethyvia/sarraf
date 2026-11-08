import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';

import { accounts, categories, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso, today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { dec, isDecimalString, toDecimalString, type DecimalString } from '@/lib/money';
import { accountBalance } from './balances';
import { DataError } from './errors';
import { hardDeleteTransactions, withLinkedChildren } from './transaction-sets';
import type { TransactionRow } from './transactions';

/** What deleting a transaction takes with it: itself and its linked refunds / reimbursements. */
export function deletionSet(db: AppDb, id: string): TransactionRow[] {
  const ids = withLinkedChildren(db, [id]);
  return db.select().from(transactions).where(inArray(transactions.id, ids)).all();
}

/**
 * Delete from Transaction detail (Decided): the transaction and its linked
 * entries go together, permanently, after the sheet lists them.
 */
export function deleteTransaction(db: AppDb, id: string): { attachmentPaths: string[] } {
  return db.transaction((tx) => hardDeleteTransactions(tx, withLinkedChildren(tx, [id])));
}

/**
 * Bulk delete is a soft delete that Undo restores, linked rows included
 * (Decided Nov 7). Returns every id it hid, for Undo.
 */
export function softDeleteTransactions(db: AppDb, ids: string[]): string[] {
  return db.transaction((tx) => {
    const all = withLinkedChildren(tx, ids);
    tx.update(transactions).set({ deletedAt: nowIso(), updatedAt: nowIso() }).where(inArray(transactions.id, all)).run();
    return all;
  });
}

export function restoreTransactions(db: AppDb, ids: string[]): void {
  db.update(transactions).set({ deletedAt: null, updatedAt: nowIso() }).where(inArray(transactions.id, ids)).run();
}

/** Soft-deleted rows are purged later (on app open), once Undo can no longer bring them back. */
export function purgeSoftDeleted(db: AppDb, olderThan: string): { attachmentPaths: string[] } {
  return db.transaction((tx) => {
    const ids = tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(isNotNull(transactions.deletedAt), lt(transactions.deletedAt, olderThan)))
      .all()
      .map((r) => r.id);
    return ids.length ? hardDeleteTransactions(tx, withLinkedChildren(tx, ids)) : { attachmentPaths: [] };
  });
}

/** Brings a Cancelled transaction (and its linked rows) back; a future date makes it Upcoming again. */
export function restoreCancelled(db: AppDb, id: string, today: string = todayDate()): void {
  db.transaction((tx) => {
    for (const t of tx.select().from(transactions).where(inArray(transactions.id, withLinkedChildren(tx, [id]))).all()) {
      if (t.status !== 'cancelled') continue;
      tx.update(transactions).set({ status: 'cleared', scheduled: t.date > today, updatedAt: nowIso() }).where(eq(transactions.id, t.id)).run();
    }
  });
}

export type BulkChange =
  | { field: 'category'; categoryId: string }
  | { field: 'ledger'; ledgerId: string }
  | { field: 'account'; accountId: string }
  | { field: 'tag'; personId: string | null };

type BulkField = 'categoryId' | 'ledgerId' | 'accountId' | 'referencePersonId';
/** What a bulk change replaced, so Undo can put it back. */
export type BulkUndo = { id: string; field: BulkField; value: string | null }[];

/**
 * Bulk actions on selected transactions (Spec §9). Each change applies only
 * where it fits — a category to rows of its kind, an account to rows already
 * in that account's currency. Returns how many rows changed and what to undo.
 */
export function bulkUpdate(db: AppDb, ids: string[], change: BulkChange): { changed: number; undo: BulkUndo } {
  return db.transaction((tx) => {
    const rows = tx.select().from(transactions).where(and(inArray(transactions.id, ids), isNull(transactions.deletedAt))).all();
    const stamp = { updatedAt: nowIso() };
    const undo: BulkUndo = [];
    const set = (t: (typeof rows)[number], field: BulkField, value: string | null) => {
      if (t[field] === value) return;
      undo.push({ id: t.id, field, value: t[field] });
      tx.update(transactions).set({ [field]: value, ...stamp }).where(eq(transactions.id, t.id)).run();
    };
    switch (change.field) {
      case 'category': {
        const cat = tx.select().from(categories).where(eq(categories.id, change.categoryId)).get();
        if (!cat) throw new DataError('not_found', 'No category');
        for (const t of rows) if (t.kind === cat.kind && !t.linkType) set(t, 'categoryId', cat.id);
        break;
      }
      case 'ledger':
        for (const t of rows) if (t.kind === 'expense' || t.kind === 'income' || t.kind === 'transfer') set(t, 'ledgerId', change.ledgerId);
        break;
      case 'account': {
        // Bulk "change account" lists only accounts in the same currency (Decided Nov 7).
        const target = tx.select().from(accounts).where(eq(accounts.id, change.accountId)).get();
        if (!target) throw new DataError('not_found', 'No account');
        const currencyOf = new Map(tx.select({ id: accounts.id, c: accounts.currency }).from(accounts).all().map((a) => [a.id, a.c]));
        for (const t of rows) {
          if (!t.accountId || currencyOf.get(t.accountId) !== target.currency || t.toAccountId === target.id) continue;
          set(t, 'accountId', target.id);
        }
        break;
      }
      case 'tag':
        for (const t of rows) if (t.kind === 'expense' || t.kind === 'income' || t.kind === 'transfer') set(t, 'referencePersonId', change.personId);
        break;
    }
    return { changed: undo.length, undo };
  });
}

/** Undo for a bulk change: puts back what it replaced. */
export function undoBulk(db: AppDb, undo: BulkUndo): void {
  db.transaction((tx) => {
    for (const u of undo) tx.update(transactions).set({ [u.field]: u.value, updatedAt: nowIso() }).where(eq(transactions.id, u.id)).run();
  });
}

/**
 * Fix balance (Decided Nov 7): enter what the bank shows; Sarraf adds a dated
 * Balance adjustment for the difference against the cleared balance on that
 * date. Not income or spending; the opening balance is never edited.
 */
export function fixBalance(db: AppDb, accountId: string, shows: DecimalString, date: string, today: string = todayDate()): { id: string; difference: DecimalString } {
  if (!isDecimalString(shows)) throw new DataError('invalid_amount', 'Not an amount');
  if (date > today) throw new DataError('invalid_target', 'Pick today or an earlier date');
  return db.transaction((tx) => {
    const account = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account) throw new DataError('not_found', 'No account');
    const difference = toDecimalString(dec(shows).minus(dec(accountBalance(tx, accountId, date))));
    if (dec(difference).isZero()) throw new DataError('invalid_amount', 'Nothing to fix: the balance already matches');
    const id = newId();
    tx.insert(transactions)
      .values({ id, kind: 'balance_adjustment', date, status: 'cleared', accountId, amount: difference, currency: account.currency, accountAmount: difference })
      .run();
    return { id, difference };
  });
}

/** "1 pending item on this account" for the Fix balance warning. */
export function pendingOnAccount(db: AppDb, accountId: string): number {
  return db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(transactions.status, ['pending', 'in_transit']),
        or(eq(transactions.accountId, accountId), eq(transactions.toAccountId, accountId)),
      ),
    )
    .all().length;
}
