import { and, eq, isNull, lte } from 'drizzle-orm';

import { transactionCharges, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { today } from '@/lib/dates';
import { dec, toDecimalString, type DecimalString, type DecimalValue } from '@/lib/money';

/**
 * Account balances, derived — never stored (Schema → Derived values, Decided).
 * Only rows that are not deleted, not scheduled and dated today or earlier count:
 * - opening balance / balance adjustment: ± account_amount, when Cleared;
 * - expense: − account_amount, when Cleared; a refund / reimbursement row (link_type set): +;
 * - income: + account_amount (what arrived), when Cleared;
 * - transfer: − account_amount on From when Cleared or In transit; + to_amount on To only when Cleared;
 * - each on-top charge: − its amount from its account, when its transaction is Cleared.
 * Pending, Cancelled and Upcoming never count; net_amount is never summed.
 */
export function accountBalances(db: AppDb, asOf: string = today()): Map<string, DecimalString> {
  const sums = new Map<string, DecimalValue>();
  const move = (accountId: string | null, amount: string | null, sign: 1 | -1) => {
    if (!accountId || amount === null) return;
    const d = dec(amount);
    sums.set(accountId, (sums.get(accountId) ?? dec('0')).plus(sign === 1 ? d : d.negated()));
  };

  const counted = and(isNull(transactions.deletedAt), eq(transactions.scheduled, false), lte(transactions.date, asOf));

  for (const t of db
    .select({
      kind: transactions.kind,
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
        if (cleared) move(t.accountId, t.accountAmount, 1);
        break;
      case 'expense':
        if (cleared) move(t.accountId, t.accountAmount, t.linkType ? 1 : -1);
        break;
      case 'transfer':
        if (cleared || t.status === 'in_transit') move(t.accountId, t.accountAmount, -1);
        if (cleared) move(t.toAccountId, t.toAmount, 1);
        break;
    }
  }

  for (const c of db
    .select({ accountId: transactionCharges.accountId, amount: transactionCharges.amount })
    .from(transactionCharges)
    .innerJoin(transactions, eq(transactions.id, transactionCharges.transactionId))
    .where(and(counted, eq(transactions.status, 'cleared'), eq(transactionCharges.deduction, 'charged_separately')))
    .all()) {
    move(c.accountId, c.amount, -1);
  }

  const out = new Map<string, DecimalString>();
  for (const [id, sum] of sums) out.set(id, toDecimalString(sum));
  return out;
}

export function accountBalance(db: AppDb, accountId: string, asOf?: string): DecimalString {
  return accountBalances(db, asOf).get(accountId) ?? '0';
}
