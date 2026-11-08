import { and, eq, isNull, lte } from 'drizzle-orm';

import { transactionCharges, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { addDays, today } from '@/lib/dates';
import { Decimal, dec, toDecimalString, type DecimalString, type DecimalValue } from '@/lib/money';

/**
 * Every movement of money into or out of an account, by date — the one place
 * the balance rule lives (Schema → Derived values, Decided). Only rows that are
 * not deleted, not scheduled and dated on or before `asOf` count:
 * - opening balance / balance adjustment: ± account_amount, when Cleared;
 * - expense: − account_amount, when Cleared; a refund / reimbursement row (link_type set): +;
 * - income: + account_amount (what arrived), when Cleared;
 * - transfer: − account_amount on From when Cleared or In transit; + to_amount on To only when Cleared;
 * - each on-top charge: − its amount from its account, when its transaction is Cleared.
 * Pending, Cancelled and Upcoming never count; net_amount is never summed.
 */
export function forEachMovement(
  db: AppDb,
  asOf: string,
  visit: (accountId: string, date: string, delta: DecimalValue, source: { transactionId: string; charge: boolean }) => void,
): void {
  const move = (accountId: string | null, date: string, amount: string | null, sign: 1 | -1, transactionId = '', charge = false) => {
    if (!accountId || amount === null) return;
    const d = dec(amount);
    visit(accountId, date, sign === 1 ? d : d.negated(), { transactionId, charge });
  };
  const counted = and(isNull(transactions.deletedAt), eq(transactions.scheduled, false), lte(transactions.date, asOf));

  for (const t of db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      date: transactions.date,
      status: transactions.status,
      accountId: transactions.accountId,
      accountAmount: transactions.accountAmount,
      toAccountId: transactions.toAccountId,
      toAmount: transactions.toAmount,
      linkType: transactions.linkType,
    })
    .from(transactions)
    .where(counted)
    .all()) {
    const cleared = t.status === 'cleared';
    switch (t.kind) {
      case 'opening_balance':
      case 'balance_adjustment':
      case 'income':
        if (cleared) move(t.accountId, t.date, t.accountAmount, 1, t.id);
        break;
      case 'expense':
        if (cleared) move(t.accountId, t.date, t.accountAmount, t.linkType ? 1 : -1, t.id);
        break;
      case 'transfer':
        if (cleared || t.status === 'in_transit') move(t.accountId, t.date, t.accountAmount, -1, t.id);
        if (cleared) move(t.toAccountId, t.date, t.toAmount, 1, t.id);
        break;
    }
  }

  for (const c of db
    .select({ accountId: transactionCharges.accountId, amount: transactionCharges.amount, date: transactions.date, id: transactions.id })
    .from(transactionCharges)
    .innerJoin(transactions, eq(transactions.id, transactionCharges.transactionId))
    .where(and(counted, eq(transactions.status, 'cleared'), eq(transactionCharges.deduction, 'charged_separately')))
    .all()) {
    move(c.accountId, c.date, c.amount, -1, c.id, true);
  }
}

/** Account balances, derived — never stored. */
export function accountBalances(db: AppDb, asOf: string = today()): Map<string, DecimalString> {
  const sums = new Map<string, DecimalValue>();
  forEachMovement(db, asOf, (id, _date, delta) => sums.set(id, (sums.get(id) ?? new Decimal(0)).plus(delta)));
  const out = new Map<string, DecimalString>();
  for (const [id, sum] of sums) out.set(id, toDecimalString(sum));
  return out;
}

export function accountBalance(db: AppDb, accountId: string, asOf?: string): DecimalString {
  return accountBalances(db, asOf).get(accountId) ?? '0';
}

/** End-of-day balances of one account for each day from..to (the trend line). */
export function balanceSeries(db: AppDb, accountId: string, from: string, to: string): { date: string; balance: DecimalString }[] {
  const byDay = new Map<string, DecimalValue>();
  let before = new Decimal(0);
  forEachMovement(db, to, (id, date, delta) => {
    if (id !== accountId) return;
    if (date < from) before = before.plus(delta);
    else byDay.set(date, (byDay.get(date) ?? new Decimal(0)).plus(delta));
  });
  const out: { date: string; balance: DecimalString }[] = [];
  let running = before;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    running = running.plus(byDay.get(d) ?? 0);
    out.push({ date: d, balance: toDecimalString(running) });
  }
  return out;
}
