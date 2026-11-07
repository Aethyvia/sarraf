import { count, eq, max } from 'drizzle-orm';

import { budgets, ledgers, recurringItems, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso } from '@/lib/dates';
import { newId } from '@/lib/id';
import { DataError, requireName } from './errors';
import { assertCanAdd, type Plan } from './limits';
import {
  describeTransactions,
  hardDeleteTransactions,
  transactionIdsWhere,
  withLinkedChildren,
  type DeletionImpact,
} from './transaction-sets';

export type Ledger = typeof ledgers.$inferSelect;

export interface NewLedger {
  name: string;
  icon?: string;
  color?: string;
}

function getLedger(db: AppDb, id: string): Ledger {
  const ledger = db.select().from(ledgers).where(eq(ledgers.id, id)).get();
  if (!ledger) throw new DataError('not_found', `No ledger ${id}`);
  return ledger;
}

/** Adds a ledger. The first ledger becomes the default. Checked against the free-plan limit. */
export function createLedger(db: AppDb, input: NewLedger, plan: Plan): string {
  const name = requireName(input.name);
  const id = newId();
  db.transaction((tx) => {
    assertCanAdd(tx, 'ledgers', plan);
    const n = tx.select({ n: count() }).from(ledgers).get()?.n ?? 0;
    const rank = (tx.select({ r: max(ledgers.rank) }).from(ledgers).get()?.r ?? -1) + 1;
    tx.insert(ledgers)
      .values({
        id,
        name,
        icon: input.icon ?? 'ledger',
        color: input.color ?? (n === 0 ? 'teal' : 'neutral'),
        isDefault: n === 0,
        rank,
      })
      .run();
  });
  return id;
}

export function updateLedger(db: AppDb, id: string, changes: { name?: string; icon?: string; color?: string }): void {
  const values: Partial<typeof ledgers.$inferInsert> = { updatedAt: nowIso() };
  if (changes.name !== undefined) values.name = requireName(changes.name);
  if (changes.icon !== undefined) values.icon = changes.icon;
  if (changes.color !== undefined) values.color = changes.color;
  db.transaction((tx) => {
    getLedger(tx, id);
    tx.update(ledgers).set(values).where(eq(ledgers.id, id)).run();
  });
}

/** Makes this the default ledger (its budgets show on Home). Exactly one ledger is the default. */
export function setDefaultLedger(db: AppDb, id: string): void {
  db.transaction((tx) => {
    const ledger = getLedger(tx, id);
    if (ledger.archivedAt) throw new DataError('archived', 'An archived ledger cannot be the default');
    tx.update(ledgers).set({ isDefault: false, updatedAt: nowIso() }).where(eq(ledgers.isDefault, true)).run();
    tx.update(ledgers).set({ isDefault: true, updatedAt: nowIso() }).where(eq(ledgers.id, id)).run();
  });
}

/** Archives a ledger: hidden from pickers; its history stays. The default ledger can't be archived. */
export function archiveLedger(db: AppDb, id: string): void {
  db.transaction((tx) => {
    const ledger = getLedger(tx, id);
    if (ledger.isDefault) throw new DataError('default_ledger', 'Choose another default ledger first');
    if (ledger.archivedAt) return;
    tx.update(ledgers).set({ archivedAt: nowIso(), updatedAt: nowIso() }).where(eq(ledgers.id, id)).run();
  });
}

/** Unarchiving counts like adding one, so the free-plan limit applies. */
export function unarchiveLedger(db: AppDb, id: string, plan: Plan): void {
  db.transaction((tx) => {
    const ledger = getLedger(tx, id);
    if (!ledger.archivedAt) return;
    assertCanAdd(tx, 'ledgers', plan);
    tx.update(ledgers).set({ archivedAt: null, updatedAt: nowIso() }).where(eq(ledgers.id, id)).run();
  });
}

function ledgerTransactionIds(db: AppDb, id: string): string[] {
  return withLinkedChildren(db, transactionIdsWhere(db, eq(transactions.ledgerId, id)));
}

export interface LedgerDeletionImpact extends DeletionImpact {
  budgets: number;
  recurringItems: number;
}

export function ledgerDeletionImpact(db: AppDb, id: string): LedgerDeletionImpact {
  return {
    ...describeTransactions(db, ledgerTransactionIds(db, id)),
    budgets: db.select({ n: count() }).from(budgets).where(eq(budgets.ledgerId, id)).get()?.n ?? 0,
    recurringItems:
      db.select({ n: count() }).from(recurringItems).where(eq(recurringItems.ledgerId, id)).get()?.n ?? 0,
  };
}

export type LedgerDeletion =
  /** Move its transactions and recurring items to another ledger, then delete it. */
  | { mode: 'move'; targetLedgerId: string }
  /** Delete it with its transactions (balances change) and recurring items. */
  | { mode: 'delete_with_transactions' };

/**
 * Deletes a ledger. Its budgets are always deleted with it (owner, Nov 7).
 * The default ledger can't be deleted. "Archive" is archiveLedger().
 */
export function deleteLedger(db: AppDb, id: string, how: LedgerDeletion): { attachmentPaths: string[] } {
  return db.transaction((tx) => {
    const ledger = getLedger(tx, id);
    if (ledger.isDefault) throw new DataError('default_ledger', 'The default ledger cannot be deleted');

    let attachmentPaths: string[] = [];
    if (how.mode === 'move') {
      if (how.targetLedgerId === id) throw new DataError('invalid_target', 'Pick a different ledger');
      const target = getLedger(tx, how.targetLedgerId);
      if (target.archivedAt) throw new DataError('archived', 'Pick a ledger that is not archived');
      const moved = { ledgerId: target.id, updatedAt: nowIso() };
      tx.update(transactions).set(moved).where(eq(transactions.ledgerId, id)).run();
      tx.update(recurringItems).set(moved).where(eq(recurringItems.ledgerId, id)).run();
    } else {
      attachmentPaths = hardDeleteTransactions(tx, ledgerTransactionIds(tx, id)).attachmentPaths;
      tx.delete(recurringItems).where(eq(recurringItems.ledgerId, id)).run();
    }
    tx.delete(budgets).where(eq(budgets.ledgerId, id)).run();
    tx.delete(ledgers).where(eq(ledgers.id, id)).run();
    return { attachmentPaths };
  });
}

export function reorderLedgers(db: AppDb, orderedIds: string[]): void {
  db.transaction((tx) => {
    orderedIds.forEach((id, rank) => {
      tx.update(ledgers).set({ rank, updatedAt: nowIso() }).where(eq(ledgers.id, id)).run();
    });
  });
}

