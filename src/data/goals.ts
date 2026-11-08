import { eq } from 'drizzle-orm';

import { accounts, goalAllocations, savingsGoals } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso, today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { Decimal, dec, isCurrencyCode, isDecimalString, toDecimalString, type DecimalString, type DecimalValue } from '@/lib/money';
import { applyAttachmentChanges, type StoredFile } from './attachments';
import { DataError, requireName } from './errors';
import { assertCanAdd, type Plan } from './limits';
import { accountFree } from './usable';

/** How much a goal holds: the sum of its allocation rows. */
export function goalTotal(db: AppDb, goalId: string): DecimalString {
  const rows = db.select({ a: goalAllocations.amount }).from(goalAllocations).where(eq(goalAllocations.goalId, goalId)).all();
  return toDecimalString(rows.reduce((s, r) => s.plus(dec(r.a)), new Decimal(0)));
}

/** "Still to go" after adding `adding`: never below zero. */
export function stillToGo(target: DecimalString, held: DecimalString, adding: DecimalString = '0'): DecimalString {
  const rest = dec(target).minus(dec(held)).minus(dec(adding));
  return toDecimalString(Decimal.max(rest, 0));
}

/**
 * Add — Savings (Decided Nov 6–7): sets money aside in a goal from one account
 * of the goal's currency. Not a transaction: no money moves, it only lowers that
 * currency's Usable. You type the amount to add, not a new total.
 */
export function addToGoal(
  db: AppDb,
  input: { goalId: string; accountId: string; amount: DecimalString; date?: string; notes?: string | null; attachments?: StoredFile[] },
): string {
  if (!isDecimalString(input.amount) || dec(input.amount).lte(0)) throw new DataError('invalid_amount', 'Enter an amount above zero');
  const id = newId();
  db.transaction((tx) => {
    const goal = tx.select().from(savingsGoals).where(eq(savingsGoals.id, input.goalId)).get();
    if (!goal) throw new DataError('not_found', 'No goal');
    if (goal.archivedAt || goal.completedAt) throw new DataError('archived', 'That goal is closed');
    const account = tx.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
    if (!account) throw new DataError('not_found', 'No account');
    if (account.archivedAt) throw new DataError('archived', 'That account is archived');
    if (account.currency !== goal.currency) throw new DataError('invalid_currency', 'Pick an account in the goal’s currency');
    tx.insert(goalAllocations)
      .values({
        id,
        goalId: goal.id,
        accountId: account.id,
        kind: 'add',
        amount: toDecimalString(dec(input.amount)),
        date: input.date ?? todayDate(),
        notes: input.notes?.trim() || null,
      })
      .run();
    applyAttachmentChanges(tx, { goalAllocationId: id }, { add: input.attachments });
  });
  return id;
}

export type Goal = typeof savingsGoals.$inferSelect;

/** New goal: one currency, a target, and the next priority (lowest priority shrinks first). Free plan: 3 goals. */
export function createGoal(db: AppDb, input: { name: string; currency: string; target: DecimalString }, plan: Plan): string {
  const name = requireName(input.name);
  if (!isCurrencyCode(input.currency)) throw new DataError('invalid_currency', 'Choose a currency');
  if (!isDecimalString(input.target) || dec(input.target).lte(0)) throw new DataError('invalid_amount', 'Enter a target above zero');
  assertCanAdd(db, 'goals', plan);
  const last = db.select({ p: savingsGoals.priority }).from(savingsGoals).all().reduce((m, r) => Math.max(m, r.p), 0);
  const id = newId();
  db.insert(savingsGoals).values({ id, name, currency: input.currency, targetAmount: toDecimalString(dec(input.target)), priority: last + 1 }).run();
  return id;
}

/** Edit target (and name). The currency is fixed once money is set aside. */
export function updateGoal(db: AppDb, id: string, input: { name: string; target: DecimalString }): void {
  const name = requireName(input.name);
  if (!isDecimalString(input.target) || dec(input.target).lte(0)) throw new DataError('invalid_amount', 'Enter a target above zero');
  db.update(savingsGoals).set({ name, targetAmount: toDecimalString(dec(input.target)), updatedAt: nowIso() }).where(eq(savingsGoals.id, id)).run();
}

/** Priority order (first = highest priority). */
export function reorderGoals(db: AppDb, ids: string[]): void {
  db.transaction((tx) => {
    ids.forEach((id, i) => tx.update(savingsGoals).set({ priority: i + 1, updatedAt: nowIso() }).where(eq(savingsGoals.id, id)).run());
  });
}

/** What a goal holds from each account (non-zero only). */
export function goalByAccount(db: AppDb, goalId: string): { accountId: string; amount: DecimalString }[] {
  const sums = new Map<string, DecimalValue>();
  for (const r of db.select().from(goalAllocations).where(eq(goalAllocations.goalId, goalId)).orderBy(goalAllocations.createdAt).all()) {
    sums.set(r.accountId, (sums.get(r.accountId) ?? new Decimal(0)).plus(dec(r.amount)));
  }
  return [...sums].filter(([, v]) => v.gt(0)).map(([accountId, v]) => ({ accountId, amount: toDecimalString(v) }));
}

/** Takes `amount` out of a goal's accounts, most recently added first. Returns the rows to write. */
function takeFromAccounts(db: AppDb, goalId: string, amount: DecimalValue): { accountId: string; amount: DecimalValue }[] {
  const out: { accountId: string; amount: DecimalValue }[] = [];
  let left = amount;
  for (const { accountId, amount: held } of goalByAccount(db, goalId).reverse()) {
    if (left.lte(0)) break;
    const take = Decimal.min(left, dec(held));
    out.push({ accountId, amount: take });
    left = left.minus(take);
  }
  return out;
}

/**
 * Take money out (Decided Nov 6): an amount (or all), back to Usable. Nothing
 * moves between accounts.
 */
export function takeOutOfGoal(db: AppDb, input: { goalId: string; amount: DecimalString | 'all'; notes?: string | null; date?: string }): void {
  db.transaction((tx) => {
    const held = dec(goalTotal(tx, input.goalId));
    const amount = input.amount === 'all' ? held : dec(input.amount);
    if (!amount.gt(0)) throw new DataError('invalid_amount', 'Enter an amount above zero');
    if (amount.gt(held)) throw new DataError('invalid_amount', 'That’s more than the goal holds');
    for (const part of takeFromAccounts(tx, input.goalId, amount)) {
      tx.insert(goalAllocations)
        .values({
          id: newId(),
          goalId: input.goalId,
          accountId: part.accountId,
          kind: 'take_out',
          amount: toDecimalString(part.amount.negated()),
          date: input.date ?? todayDate(),
          notes: input.notes?.trim() || null,
        })
        .run();
    }
  });
}

/** Mark as complete (Decided Nov 6): releases everything in the goal back to Usable. */
export function completeGoal(db: AppDb, goalId: string, date: string = todayDate()): void {
  db.transaction((tx) => {
    for (const { accountId, amount } of goalByAccount(tx, goalId)) {
      tx.insert(goalAllocations).values({ id: newId(), goalId, accountId, kind: 'release', amount: toDecimalString(dec(amount).negated()), date }).run();
    }
    tx.update(savingsGoals).set({ completedAt: nowIso(), updatedAt: nowIso() }).where(eq(savingsGoals.id, goalId)).run();
  });
}

/** Deletes a goal and its history. The money it held goes back to Usable. */
export function deleteGoal(db: AppDb, goalId: string): void {
  db.delete(savingsGoals).where(eq(savingsGoals.id, goalId)).run();
}

/**
 * Overspending (Decided): when an account's balance falls below what's set
 * aside from it, the lowest-priority goals shrink first until it fits.
 * Returns the goals that shrank and by how much.
 */
export function shrinkGoalsToFit(db: AppDb, accountId: string, date: string = todayDate()): { goalId: string; amount: DecimalString }[] {
  const shrunk: { goalId: string; amount: DecimalString }[] = [];
  db.transaction((tx) => {
    const { balance, setAside } = accountFree(tx, accountId, date);
    let over = dec(setAside).minus(Decimal.max(dec(balance), 0));
    if (over.lte(0)) return;
    const goals = tx.select().from(savingsGoals).all().sort((a, b) => b.priority - a.priority);
    for (const goal of goals) {
      if (over.lte(0)) break;
      const fromThis = goalByAccount(tx, goal.id).find((g) => g.accountId === accountId);
      if (!fromThis) continue;
      const cut = Decimal.min(over, dec(fromThis.amount));
      tx.insert(goalAllocations).values({ id: newId(), goalId: goal.id, accountId, kind: 'shrink', amount: toDecimalString(cut.negated()), date }).run();
      shrunk.push({ goalId: goal.id, amount: toDecimalString(cut) });
      over = over.minus(cut);
    }
  });
  return shrunk;
}

/** Goal history, newest first. */
export function goalHistory(db: AppDb, goalId: string) {
  return db.select().from(goalAllocations).where(eq(goalAllocations.goalId, goalId)).all().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
