import { and, eq, inArray, isNull } from 'drizzle-orm';

import { accounts, people, personEntries, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { Decimal, dec, isDecimalString, toDecimalString, type DecimalString, type DecimalValue } from '@/lib/money';
import { sortByCurrencyOrder } from './currency-order';
import { DataError } from './errors';
import { splitOf } from './splits';

type EntryRow = typeof personEntries.$inferSelect;

/** One line of a person's history, with the running balance in its currency after it. */
export interface PersonHistoryLine {
  entry: EntryRow;
  /** The transaction behind it; null for Mark as settled. */
  transaction: typeof transactions.$inferSelect | null;
  /** False while its transaction is Pending, In transit, Cancelled or future-dated: shown, not counted. */
  counts: boolean;
  /** Running balance in this currency after this line (counted lines only). */
  running: DecimalString;
}

/**
 * A person's entries, oldest first, with whether each counts (Spec §9d):
 * only entries whose transaction is Cleared and not future-dated count;
 * settlements always count. Deleted transactions are left out.
 */
function entriesOf(db: AppDb, personId: string, today: string) {
  const entries = db.select().from(personEntries).where(eq(personEntries.personId, personId)).all();
  const txIds = entries.map((e) => e.transactionId).filter((x): x is string => !!x);
  const txs = new Map(
    (txIds.length ? db.select().from(transactions).where(inArray(transactions.id, txIds)).all() : []).map((t) => [t.id, t]),
  );
  return entries
    .map((entry) => {
      const t = entry.transactionId ? (txs.get(entry.transactionId) ?? null) : null;
      if (entry.transactionId && (!t || t.deletedAt)) return null;
      const counts = !t || (t.status === 'cleared' && !t.scheduled && t.date <= today);
      return { entry, transaction: t, counts };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.createdAt.localeCompare(b.entry.createdAt));
}

/**
 * What a person owes, per currency (Spec §13). + they owe you, − you owe them.
 * Currencies that net to zero are kept when they have history, so the page can
 * show "settled up".
 */
export function personBalances(db: AppDb, personId: string, today: string = todayDate()): Map<string, DecimalString> {
  const sums = new Map<string, DecimalValue>();
  for (const { entry, counts } of entriesOf(db, personId, today)) {
    if (!counts) continue;
    sums.set(entry.currency, (sums.get(entry.currency) ?? new Decimal(0)).plus(dec(entry.amount)));
  }
  return new Map(sortByCurrencyOrder(db, [...sums], ([c]) => c).map(([c, v]) => [c, toDecimalString(v)]));
}

/** The person page's history, newest first, with running balances per currency. */
export function personHistory(db: AppDb, personId: string, today: string = todayDate()): PersonHistoryLine[] {
  const running = new Map<string, DecimalValue>();
  const lines = entriesOf(db, personId, today).map(({ entry, transaction, counts }) => {
    const before = running.get(entry.currency) ?? new Decimal(0);
    const after = counts ? before.plus(dec(entry.amount)) : before;
    running.set(entry.currency, after);
    return { entry, transaction, counts, running: toDecimalString(after) };
  });
  return lines.reverse();
}

/** A person's balance over time in one currency, one point per day with a counted entry (for the small trend line). */
export function personSeries(db: AppDb, personId: string, currency: string, today: string = todayDate()): { date: string; balance: DecimalString }[] {
  const points: { date: string; balance: DecimalString }[] = [];
  let sum = new Decimal(0);
  for (const { entry, counts } of entriesOf(db, personId, today)) {
    if (!counts || entry.currency !== currency) continue;
    sum = sum.plus(dec(entry.amount));
    if (points.length && points[points.length - 1].date === entry.date) points.pop();
    points.push({ date: entry.date, balance: toDecimalString(sum) });
  }
  return points;
}

/**
 * Mark as settled (Spec §9e): lowers what they owe you, or what you owe them,
 * in one currency, by the full balance or part of it. No account moves.
 */
export function markSettled(
  db: AppDb,
  input: { personId: string; currency: string; amount: DecimalString; note?: string | null; date?: string },
  today: string = todayDate(),
): string {
  if (!isDecimalString(input.amount) || dec(input.amount).lte(0)) throw new DataError('invalid_amount', 'Enter an amount above zero');
  return db.transaction((tx) => {
    if (!tx.select({ id: people.id }).from(people).where(eq(people.id, input.personId)).get()) throw new DataError('not_found', 'No person');
    const balance = dec(personBalances(tx, input.personId, today).get(input.currency) ?? '0');
    if (balance.isZero()) throw new DataError('nothing_owed', 'Nothing to settle in that currency');
    if (dec(input.amount).gt(balance.abs())) throw new DataError('invalid_amount', 'That’s more than the balance');
    const id = newId();
    // Moves the balance toward zero.
    const amount = balance.isPositive() ? dec(input.amount).negated() : dec(input.amount);
    tx.insert(personEntries)
      .values({
        id,
        personId: input.personId,
        transactionId: null,
        source: 'settlement',
        currency: input.currency,
        amount: toDecimalString(amount),
        date: input.date ?? today,
        note: input.note?.trim() || null,
      })
      .run();
    return id;
  });
}

/** Removes a Mark as settled entry (from the person page's history). */
export function deleteSettlement(db: AppDb, entryId: string): void {
  db.delete(personEntries).where(and(eq(personEntries.id, entryId), eq(personEntries.source, 'settlement'))).run();
}

/**
 * The grey "Expected back" line on a person page (Decided Nov 7): reimbursable
 * expenses still waiting on this person, per currency. Not part of their balance.
 */
export function expectedBack(db: AppDb, personId: string): { totals: Map<string, DecimalString>; count: number } {
  const waiting = db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.expectedFromPersonId, personId),
        inArray(transactions.reimbursementStatus, ['awaiting', 'partly_back']),
        eq(transactions.status, 'cleared'),
        isNull(transactions.deletedAt),
      ),
    )
    .all();
  const sums = new Map<string, DecimalValue>();
  let count = 0;
  for (const t of waiting) {
    const { currency, outstanding } = outstandingOf(db, t);
    if (outstanding.lte(0)) continue;
    count += 1;
    sums.set(currency, (sums.get(currency) ?? new Decimal(0)).plus(outstanding));
  }
  return { totals: new Map([...sums].map(([c, v]) => [c, toDecimalString(v)])), count };
}

/** What a reimbursable expense is still owed back, in the currency it was charged in. */
export function outstandingOf(db: AppDb, t: typeof transactions.$inferSelect): { currency: string; outstanding: DecimalValue } {
  const back = db
    .select({ countsAs: transactions.countsAsAmount })
    .from(transactions)
    .where(and(eq(transactions.parentId, t.id), eq(transactions.linkType, 'reimbursement'), isNull(transactions.deletedAt)))
    .all()
    .reduce((s, r) => s.plus(dec(r.countsAs ?? '0')), new Decimal(0));
  const charged = dec(t.accountAmount ?? t.amount);
  return { currency: chargedCurrencyOf(db, t), outstanding: charged.minus(back) };
}

/** The currency an expense was charged in: its account's, or the bill's when someone else paid. */
export function chargedCurrencyOf(db: AppDb, t: Pick<typeof transactions.$inferSelect, 'accountId' | 'currency' | 'accountAmount'>): string {
  if (!t.accountId) return t.currency;
  return db.select({ c: accounts.currency }).from(accounts).where(eq(accounts.id, t.accountId)).get()?.c ?? t.currency;
}

/**
 * People in a split you paid who carry a share (not a treat), with their live
 * balance in the split's currency. A refund leaves their shares alone
 * (Decided Nov 8), so screens show this next to a refund.
 */
export function sharesKeptByRefund(db: AppDb, expenseId: string, today: string = todayDate()): { personId: string; name: string; share: DecimalString; currency: string; balance: DecimalString }[] {
  const t = db.select().from(transactions).where(eq(transactions.id, expenseId)).get();
  if (!t || t.kind !== 'expense' || t.paidByPersonId) return [];
  const split = splitOf(db, expenseId);
  if (!split) return [];
  const currency = chargedCurrencyOf(db, t);
  return split.shares
    .filter((sh) => sh.personId && !sh.treat && dec(sh.amount).gt(0))
    .map((sh) => ({
      personId: sh.personId!,
      name: db.select({ name: people.name }).from(people).where(eq(people.id, sh.personId!)).get()?.name ?? '',
      share: sh.amount,
      currency,
      balance: personBalances(db, sh.personId!, today).get(currency) ?? '0',
    }));
}
