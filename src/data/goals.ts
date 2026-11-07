import { eq } from 'drizzle-orm';

import { accounts, goalAllocations, savingsGoals } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { Decimal, dec, isDecimalString, toDecimalString, type DecimalString } from '@/lib/money';
import { applyAttachmentChanges, type StoredFile } from './attachments';
import { DataError } from './errors';

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
