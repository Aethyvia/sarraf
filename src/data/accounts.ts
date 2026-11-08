import { and, eq, isNotNull, isNull, max, or } from 'drizzle-orm';

import {
  accounts,
  currencyOrder,
  goalAllocations,
  recurringItems,
  savingsGoals,
  transactionCharges,
  transactions,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { today, nowIso } from '@/lib/dates';
import { newId } from '@/lib/id';
import { dec, isCurrencyCode, isDecimalString, toDecimalString } from '@/lib/money';
import { DataError, requireName } from './errors';
import { assertCanAdd, type Plan } from './limits';
import {
  describeTransactions,
  hardDeleteTransactions,
  transactionIdsWhere,
  withLinkedChildren,
  type DeletionImpact,
} from './transaction-sets';

export type Account = typeof accounts.$inferSelect;

/** Default icon and colour for a new account; the user can change them any time. */
export function defaultAccountLook(name: string, institution: string | null): { icon: string; color: string } {
  if (/\bcash\b/i.test(name)) return { icon: 'cash', color: 'gold' };
  if (institution) return { icon: 'wallet', color: 'orange' };
  return { icon: 'bank', color: 'teal' };
}

export interface NewAccount {
  name: string;
  currency: string;
  institution?: string | null;
  icon?: string;
  color?: string;
  /** Optional "Current balance": creates one Opening balance transaction dated today. */
  currentBalance?: string | null;
}

/** Adds an account. Save needs only a name and currency. Checked against the free-plan limit. */
export function createAccount(db: AppDb, input: NewAccount, plan: Plan): string {
  const name = requireName(input.name);
  if (!isCurrencyCode(input.currency)) {
    throw new DataError('invalid_currency', `Unknown currency ${input.currency}`);
  }
  const balance = input.currentBalance?.trim() || null;
  if (balance !== null && !isDecimalString(balance)) {
    throw new DataError('invalid_amount', `Not an amount: ${balance}`);
  }
  const institution = input.institution?.trim() || null;
  const look = defaultAccountLook(name, institution);
  const id = newId();

  db.transaction((tx) => {
    assertCanAdd(tx, 'accounts', plan);
    const rank = (tx.select({ r: max(accounts.rank) }).from(accounts).get()?.r ?? -1) + 1;
    tx.insert(accounts)
      .values({
        id,
        name,
        currency: input.currency,
        institution,
        icon: input.icon ?? look.icon,
        color: input.color ?? look.color,
        rank,
      })
      .run();

    // A new currency gets a Home tile at the end of the order.
    if (!tx.select().from(currencyOrder).where(eq(currencyOrder.currency, input.currency)).get()) {
      const last = tx.select({ r: max(currencyOrder.rank) }).from(currencyOrder).get()?.r ?? -1;
      tx.insert(currencyOrder).values({ currency: input.currency, rank: last + 1 }).run();
    }

    if (balance !== null && !dec(balance).isZero()) {
      const amount = toDecimalString(dec(balance));
      tx.insert(transactions)
        .values({
          id: newId(),
          kind: 'opening_balance',
          date: today(),
          status: 'cleared',
          accountId: id,
          amount,
          currency: input.currency,
          accountAmount: amount,
        })
        .run();
    }
  });
  return id;
}

export interface AccountChanges {
  name?: string;
  institution?: string | null;
  icon?: string;
  color?: string;
}

/** Edits an account. The currency can never change after creation. */
export function updateAccount(db: AppDb, id: string, changes: AccountChanges): void {
  const values: Partial<typeof accounts.$inferInsert> = { updatedAt: nowIso() };
  if (changes.name !== undefined) values.name = requireName(changes.name);
  if (changes.institution !== undefined) values.institution = changes.institution?.trim() || null;
  if (changes.icon !== undefined) values.icon = changes.icon;
  if (changes.color !== undefined) values.color = changes.color;
  db.transaction((tx) => {
    if (!tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get()) {
      throw new DataError('not_found', `No account ${id}`);
    }
    tx.update(accounts).set(values).where(eq(accounts.id, id)).run();
  });
}

/** Sets the custom order (Accounts → Sort → Custom order, drag only). */
export function reorderAccounts(db: AppDb, orderedIds: string[]): void {
  db.transaction((tx) => {
    orderedIds.forEach((id, rank) => {
      tx.update(accounts).set({ rank, updatedAt: nowIso() }).where(eq(accounts.id, id)).run();
    });
  });
}

/** How much each goal has set aside from this account (non-zero only). */
export function setAsideByGoal(db: AppDb, accountId: string): { goalId: string; goalName: string; amount: string }[] {
  const rows = db
    .select({ goalId: goalAllocations.goalId, goalName: savingsGoals.name, amount: goalAllocations.amount })
    .from(goalAllocations)
    .innerJoin(savingsGoals, eq(savingsGoals.id, goalAllocations.goalId))
    .where(eq(goalAllocations.accountId, accountId))
    .all();
  const totals = new Map<string, { goalName: string; sum: ReturnType<typeof dec> }>();
  for (const r of rows) {
    const t = totals.get(r.goalId) ?? { goalName: r.goalName, sum: dec('0') };
    t.sum = t.sum.plus(dec(r.amount));
    totals.set(r.goalId, t);
  }
  return [...totals]
    .filter(([, t]) => !t.sum.isZero())
    .map(([goalId, t]) => ({ goalId, goalName: t.goalName, amount: toDecimalString(t.sum) }));
}

/**
 * Archives an account: hidden from pickers and lists, its balance stops
 * counting in totals and Usable, and it frees a free-plan slot. Everything it
 * had set aside for goals is released (a permanent `release` row per goal).
 */
export function archiveAccount(db: AppDb, id: string): void {
  db.transaction((tx) => {
    const account = tx.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!account) throw new DataError('not_found', `No account ${id}`);
    if (account.archivedAt) return;
    const date = today();
    for (const { goalId, amount } of setAsideByGoal(tx, id)) {
      tx.insert(goalAllocations)
        .values({
          id: newId(),
          goalId,
          accountId: id,
          kind: 'release',
          amount: toDecimalString(dec(amount).negated()),
          date,
          notes: null,
        })
        .run();
    }
    tx.update(accounts).set({ archivedAt: nowIso(), updatedAt: nowIso() }).where(eq(accounts.id, id)).run();
  });
}

/** Unarchives an account. Counts like adding one, so the free-plan limit applies. Released goal money stays released. */
export function unarchiveAccount(db: AppDb, id: string, plan: Plan): void {
  db.transaction((tx) => {
    const account = tx.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!account) throw new DataError('not_found', `No account ${id}`);
    if (!account.archivedAt) return;
    assertCanAdd(tx, 'accounts', plan);
    tx.update(accounts).set({ archivedAt: null, updatedAt: nowIso() }).where(eq(accounts.id, id)).run();
  });
}

/** Every transaction that moves this account: paid from / into, transfer To, or an on-top charge from it. */
function accountTransactionIds(db: AppDb, id: string): string[] {
  const direct = transactionIdsWhere(db, or(eq(transactions.accountId, id), eq(transactions.toAccountId, id)));
  const viaCharges = db
    .selectDistinct({ id: transactionCharges.transactionId })
    .from(transactionCharges)
    .where(and(eq(transactionCharges.accountId, id), isNotNull(transactionCharges.accountId)))
    .all()
    .map((r) => r.id);
  return withLinkedChildren(db, [...new Set([...direct, ...viaCharges])]);
}

/** For the delete sheet: how many transactions use it, over which dates, and which other balances change. */
export function accountDeletionImpact(db: AppDb, id: string): DeletionImpact {
  return describeTransactions(db, accountTransactionIds(db, id), id);
}

/**
 * Deletes an account together with every transaction that uses it (and their
 * linked refunds, charges, split shares, person entries and attachments), its
 * goal allocations and the recurring items that use it. Can't be undone.
 * An account nothing uses is deleted the same way, after a plain confirmation.
 */
export function deleteAccount(db: AppDb, id: string): { attachmentPaths: string[] } {
  return db.transaction((tx) => {
    if (!tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get()) {
      throw new DataError('not_found', `No account ${id}`);
    }
    const result = hardDeleteTransactions(tx, accountTransactionIds(tx, id));
    tx.delete(goalAllocations).where(eq(goalAllocations.accountId, id)).run();
    tx.delete(recurringItems)
      .where(or(eq(recurringItems.accountId, id), eq(recurringItems.toAccountId, id)))
      .run();
    tx.delete(accounts).where(eq(accounts.id, id)).run();
    return result;
  });
}

/** Custom order: moves an account to a 0-based position among the active ones; the rest keep their order. */
export function moveAccount(db: AppDb, accountId: string, position: number): void {
  const active = db.select({ id: accounts.id }).from(accounts).where(isNull(accounts.archivedAt)).orderBy(accounts.rank).all().map((a) => a.id);
  const rest = active.filter((id) => id !== accountId);
  const next = [...rest.slice(0, position), accountId, ...rest.slice(position)];
  db.transaction((tx) => {
    next.forEach((id, rank) => tx.update(accounts).set({ rank }).where(eq(accounts.id, id)).run());
  });
}
