import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import { accounts, currencyOrder, transactionCharges, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { monthOf, monthRange, today as todayDate } from '@/lib/dates';
import { Decimal, convert, dec, toDecimalString, type DecimalString, type DecimalValue } from '@/lib/money';
import { marketRate } from './rates';
import { currencyPositions, type CurrencyPosition } from './usable';

export interface CurrencyTile extends CurrencyPosition {
  /** This month's income in this currency, across all ledgers. */
  in: DecimalString;
  /** This month's spending in this currency, across all ledgers (refunds lower it). */
  out: DecimalString;
  /** Money back this month (refunds and reimbursements), already taken off `out`; shown as "spent · back" (owner, Nov 14). */
  back: DecimalString;
  accountCount: number;
}

/**
 * Home's currency tiles (Spec §8 — Decided): a tile per currency that has an
 * active account, in the Reorder currencies order. In / Out are this month's
 * Cleared income and spending in that currency across all ledgers:
 * - transfers between your accounts or with people aren't counted;
 * - an expense someone else paid for you counts in its own currency;
 * - a refund or reimbursement lowers Out in the original expense's currency
 *   (by what it counts as);
 * - on-top charges count as Out in their account's currency;
 * - opening balances and balance adjustments never count.
 */
export function currencyTiles(db: AppDb, asOf: string = todayDate()): CurrencyTile[] {
  const positions = currencyPositions(db, asOf);
  const { from } = monthRange(monthOf(asOf));
  const flows = monthFlows(db, from, asOf);
  const counts = new Map<string, number>();
  for (const a of db.select({ c: accounts.currency }).from(accounts).where(isNull(accounts.archivedAt)).all()) {
    counts.set(a.c, (counts.get(a.c) ?? 0) + 1);
  }
  const order = new Map(db.select().from(currencyOrder).all().map((r) => [r.currency, r.rank]));
  return [...positions.values()]
    .filter((p) => counts.has(p.currency))
    .sort((a, b) => (order.get(a.currency) ?? 999) - (order.get(b.currency) ?? 999) || a.currency.localeCompare(b.currency))
    .map((p) => ({
      ...p,
      in: toDecimalString(flows.in.get(p.currency) ?? new Decimal(0)),
      out: toDecimalString(flows.out.get(p.currency) ?? new Decimal(0)),
      back: toDecimalString(flows.back.get(p.currency) ?? new Decimal(0)),
      accountCount: counts.get(p.currency) ?? 0,
    }));
}

/** Income and spending per currency for Cleared rows dated from..to. */
export function monthFlows(db: AppDb, from: string, to: string): { in: Map<string, DecimalValue>; out: Map<string, DecimalValue>; back: Map<string, DecimalValue> } {
  const inSum = new Map<string, DecimalValue>();
  const outSum = new Map<string, DecimalValue>();
  const backSum = new Map<string, DecimalValue>();
  const add = (m: Map<string, DecimalValue>, c: string, v: DecimalValue) => m.set(c, (m.get(c) ?? new Decimal(0)).plus(v));
  const currencyOf = new Map(db.select({ id: accounts.id, c: accounts.currency }).from(accounts).all().map((a) => [a.id, a.c]));

  const counted = and(
    isNull(transactions.deletedAt),
    eq(transactions.scheduled, false),
    eq(transactions.status, 'cleared'),
    gte(transactions.date, from),
    lte(transactions.date, to),
  );
  const rows = db.select().from(transactions).where(and(counted, inArray(transactions.kind, ['income', 'expense']))).all();
  const parents = new Map<string, (typeof rows)[number]>();
  const parentIds = rows.filter((r) => r.parentId).map((r) => r.parentId!);
  if (parentIds.length) {
    for (const p of db.select().from(transactions).where(inArray(transactions.id, parentIds)).all()) parents.set(p.id, p);
  }
  /** The currency an expense's spending is in: its account's, or its own when someone else paid. */
  const spendCurrency = (t: (typeof rows)[number]) => (t.accountId ? currencyOf.get(t.accountId)! : t.currency);

  for (const t of rows) {
    if (t.kind === 'income') {
      if (t.accountId && t.accountAmount) add(inSum, currencyOf.get(t.accountId)!, dec(t.accountAmount));
      continue;
    }
    if (t.linkType) {
      // Money back lowers the original expense's spending, in its currency, by what it counts as.
      const parent = t.parentId ? parents.get(t.parentId) : undefined;
      const currency = parent ? spendCurrency(parent) : spendCurrency(t);
      const amount = t.countsAsAmount ?? t.accountAmount;
      if (amount) {
        add(outSum, currency, dec(amount).negated());
        add(backSum, currency, dec(amount));
      }
      continue;
    }
    const amount = t.accountId ? t.accountAmount : t.amount;
    if (amount) add(outSum, spendCurrency(t), dec(amount));
  }

  for (const c of db
    .select({ accountId: transactionCharges.accountId, amount: transactionCharges.amount })
    .from(transactionCharges)
    .innerJoin(transactions, eq(transactions.id, transactionCharges.transactionId))
    .where(and(counted, eq(transactionCharges.deduction, 'charged_separately')))
    .all()) {
    if (c.accountId) add(outSum, currencyOf.get(c.accountId)!, dec(c.amount));
  }
  return { in: inSum, out: outSum, back: backSum };
}

export interface EstimatedTotal {
  currency: string;
  /** Null when a currency has no market rate to convert with. */
  total: DecimalString | null;
  /** Each tile's "≈" in the default currency (absent for the default currency itself). */
  perCurrency: Map<string, DecimalString>;
  /** When the rates used were fetched (the oldest), for "rates from Nov 5". */
  ratesFrom: string | null;
  missing: string[];
}

/**
 * Home's estimated total: every active account converted to the default
 * currency at market rates. Display only — a rough net worth, never stored.
 */
export function estimatedTotal(db: AppDb, defaultCurrency: string, asOf: string = todayDate()): EstimatedTotal {
  const positions = currencyPositions(db, asOf);
  let total = new Decimal(0);
  let ratesFrom: string | null = null;
  const perCurrency = new Map<string, DecimalString>();
  const missing: string[] = [];
  for (const p of positions.values()) {
    if (p.currency === defaultCurrency) {
      total = total.plus(dec(p.balance));
      continue;
    }
    const rate = marketRate(db, p.currency, defaultCurrency);
    if (!rate) {
      missing.push(p.currency);
      continue;
    }
    const converted = convert(p.balance, rate.rate, defaultCurrency);
    perCurrency.set(p.currency, converted);
    total = total.plus(dec(converted));
    if (ratesFrom === null || rate.fetchedAt < ratesFrom) ratesFrom = rate.fetchedAt;
  }
  return { currency: defaultCurrency, total: missing.length ? null : toDecimalString(total), perCurrency, ratesFrom, missing };
}

/** After this long without fresh rates, Home warns (Decided Nov 7). */
export const RATES_WARN_AFTER_DAYS = 7;
