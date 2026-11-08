import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import { accounts, categories, splitShares, transactionCharges, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { Decimal, convert, dec, toDecimalString, type DecimalString, type DecimalValue } from '@/lib/money';

/** Uncategorized spending or income is kept under this key. */
export const UNCATEGORIZED = 'uncategorized';

export interface CategoryTotal {
  /** A top-level category id (subcategories roll up), the built-in Fees & charges id, or UNCATEGORIZED. */
  categoryId: string;
  amount: DecimalString;
  /** How many transactions add to it (money back included). */
  count: number;
}

export interface Flows {
  currency: string;
  spending: CategoryTotal[];
  income: CategoryTotal[];
  totalSpending: DecimalString;
  totalIncome: DecimalString;
}

export interface FlowFilter {
  currency: string;
  from: string;
  to: string;
  /** Null: every ledger. */
  ledgerId?: string | null;
}

type Tx = typeof transactions.$inferSelect;
type Charge = typeof transactionCharges.$inferSelect;

/**
 * Spending and income per category in one currency over a date range
 * (Spec §11a, §15a — Decided). Budgets and Analytics both read this, so they
 * always agree:
 * - Only Cleared, non-future rows count. Transfers, opening balances and
 *   balance adjustments are never spending or income (their fees are).
 * - An expense counts in the currency of the account the money left (or the
 *   bill's, when someone else paid). Its non-tax charges count under Fees &
 *   charges; tax charges count nowhere.
 * - A split you paid counts only your share plus treated shares.
 * - Income counts before deductions; its non-tax charges are Fees & charges.
 * - Refunds and reimbursements lower the original's category on the day the
 *   money arrived, by what they count as in the original's currency.
 * - Subcategories roll up into their parent.
 */
export function flows(db: AppDb, filter: FlowFilter): Flows {
  const cats = new Map(db.select().from(categories).all().map((c) => [c.id, c]));
  const fees = [...cats.values()].find((c) => c.isSystem)?.id ?? UNCATEGORIZED;
  const top = (id: string | null) => {
    if (!id) return UNCATEGORIZED;
    const c = cats.get(id);
    return c?.parentId ?? id;
  };
  const currencyOf = new Map(db.select({ id: accounts.id, c: accounts.currency }).from(accounts).all().map((a) => [a.id, a.c]));

  const rows = db
    .select()
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.status, 'cleared'),
        eq(transactions.scheduled, false),
        gte(transactions.date, filter.from),
        lte(transactions.date, filter.to),
      ),
    )
    .all();
  const parentIds = [...new Set(rows.map((r) => r.parentId).filter((x): x is string => !!x))];
  const parents = new Map((parentIds.length ? db.select().from(transactions).where(inArray(transactions.id, parentIds)).all() : []).map((p) => [p.id, p]));
  const inLedger = (t: Tx) => !filter.ledgerId || t.ledgerId === filter.ledgerId;

  const ids = rows.map((r) => r.id);
  const charges = new Map<string, Charge[]>();
  const shares = new Map<string, (typeof splitShares.$inferSelect)[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    for (const c of db.select().from(transactionCharges).where(inArray(transactionCharges.transactionId, part)).all()) {
      charges.set(c.transactionId, [...(charges.get(c.transactionId) ?? []), c]);
    }
    for (const s of db.select().from(splitShares).where(inArray(splitShares.transactionId, part)).all()) {
      shares.set(s.transactionId, [...(shares.get(s.transactionId) ?? []), s]);
    }
  }

  const spend = new Map<string, { amount: DecimalValue; ids: Set<string> }>();
  const earn = new Map<string, { amount: DecimalValue; ids: Set<string> }>();
  const addTo = (m: typeof spend, key: string, amount: DecimalValue, txId: string) => {
    const e = m.get(key) ?? { amount: new Decimal(0), ids: new Set<string>() };
    e.amount = e.amount.plus(amount);
    e.ids.add(txId);
    m.set(key, e);
  };

  for (const t of rows) {
    if (t.kind === 'opening_balance' || t.kind === 'balance_adjustment') continue;

    // Money back: lowers the original's category, in the original's currency.
    if (t.linkType && t.parentId) {
      const p = parents.get(t.parentId);
      if (!p || !inLedger(p)) continue;
      const pc = p.accountId ? currencyOf.get(p.accountId) : p.currency;
      if (pc === filter.currency) addTo(spend, top(p.categoryId), dec(t.countsAsAmount ?? t.accountAmount ?? t.amount).negated(), t.id);
      continue;
    }
    if (!inLedger(t)) continue;

    const accountCurrency = t.accountId ? currencyOf.get(t.accountId) : t.currency;
    const main = t.currency;
    const own = charges.get(t.id) ?? [];

    // Every non-tax charge is Fees & charges spending, in the currency it was paid in.
    for (const c of own) {
      if (c.isTax) continue;
      const at = chargeCurrency(t, c, accountCurrency ?? main, t.kind === 'transfer' && t.toAccountId ? currencyOf.get(t.toAccountId) : undefined);
      if (at.currency === filter.currency) addTo(spend, fees, at.amount, t.id);
    }

    if (t.kind === 'expense' && accountCurrency === filter.currency) {
      // The category gets what left the account, less the charges inside it.
      const charged = dec(t.accountAmount ?? t.amount);
      const inside = own
        .filter((c) => c.deduction === 'already_deducted')
        .reduce((s, c) => s.plus(chargeCurrency(t, c, accountCurrency).amount), new Decimal(0));
      let mine = charged.minus(inside);
      const split = shares.get(t.id);
      if (split && !t.paidByPersonId && charged.gt(0)) {
        // I paid: my share plus treats (Decided Oct 10).
        const kept = split.filter((s) => s.personId === null || s.isTreat).reduce((s, x) => s.plus(dec(x.shareAmount)), new Decimal(0));
        mine = mine.times(kept).dividedBy(charged);
      }
      addTo(spend, top(t.categoryId), mine, t.id);
    }

    if (t.kind === 'income' && accountCurrency === filter.currency) {
      // Before deductions: what arrived plus what was taken out inside it.
      const inside = own
        .filter((c) => c.deduction === 'already_deducted')
        .reduce((s, c) => s.plus(chargeCurrency(t, c, accountCurrency).amount), new Decimal(0));
      addTo(earn, top(t.categoryId), dec(t.accountAmount ?? t.amount).plus(inside), t.id);
    }
  }

  const list = (m: typeof spend) =>
    [...m]
      .map(([categoryId, v]) => ({ categoryId, amount: toDecimalString(v.amount), count: v.ids.size }))
      .filter((x) => !dec(x.amount).isZero())
      .sort((a, b) => dec(b.amount).comparedTo(dec(a.amount)));
  const spending = list(spend);
  const income = list(earn);
  const total = (xs: CategoryTotal[]) => toDecimalString(xs.reduce((s, x) => s.plus(dec(x.amount)), new Decimal(0)));
  return { currency: filter.currency, spending, income, totalSpending: total(spending), totalIncome: total(income) };
}

/**
 * Where a charge counts: on-top charges in their own account's currency;
 * inside charges converted into the account the transaction pays from or
 * into (for a transfer, the From side unless the charge is in To's currency).
 */
function chargeCurrency(t: Tx, c: Charge, accountCurrency: string, toCurrency?: string): { currency: string; amount: DecimalValue } {
  if (c.deduction === 'charged_separately') return { currency: c.currency, amount: dec(c.amount) };
  if (c.currency === accountCurrency || (toCurrency && c.currency === toCurrency)) return { currency: c.currency, amount: dec(c.amount) };
  // Into the main amount's currency first (a third currency carries its own rate).
  const inMain = c.currency === t.currency ? c.amount : c.rate ? convert(c.amount, c.rate, t.currency) : c.amount;
  if (t.kind === 'transfer') return { currency: t.currency, amount: dec(inMain) };
  if (t.currency !== accountCurrency && t.rate) return { currency: accountCurrency, amount: dec(convert(inMain, t.rate, accountCurrency)) };
  return { currency: t.currency, amount: dec(inMain) };
}
