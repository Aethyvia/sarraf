import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import { accounts, transactionCharges, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { Decimal, convert, dec, roundToMinor, toDecimalString, type DecimalString, type DecimalValue } from '@/lib/money';
import { marketRate } from './rates';

export interface ConversionRoute {
  key: string;
  /** "Payoneer USD → Alfalah PKR", or "Card spend in AED" for expenses typed in another currency. */
  label: string;
  count: number;
  fees: DecimalString;
  /** Null when no market rate was saved for any of its rows. */
  rateGap: DecimalString | null;
  total: DecimalString;
}

export interface ConversionCost {
  currency: string;
  total: DecimalString;
  fees: DecimalString;
  rateGap: DecimalString;
  /** How much was moved between currencies, in the display currency. */
  moved: DecimalString;
  routes: ConversionRoute[];
  /** Rows whose amounts couldn't be shown in the display currency (no market rate known). */
  skipped: number;
}

/**
 * What converting cost you (Ideas added Nov 7): for every Cleared row that
 * changed currency in the range, the non-tax fees entered plus the rate gap
 * (the market rate saved at entry vs the rate actually got), shown in the
 * everyday currency at today's market rates. All ledgers.
 */
export function conversionCost(db: AppDb, input: { from: string; to: string; currency: string }): ConversionCost {
  const names = new Map(db.select().from(accounts).all().map((a) => [a.id, a]));
  const rows = db
    .select()
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.status, 'cleared'),
        eq(transactions.scheduled, false),
        gte(transactions.date, input.from),
        lte(transactions.date, input.to),
        inArray(transactions.kind, ['expense', 'income', 'transfer']),
      ),
    )
    .all()
    .filter((t) => t.rate !== null && !t.linkType);
  const charges = new Map<string, (typeof transactionCharges.$inferSelect)[]>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    for (const c of db.select().from(transactionCharges).where(inArray(transactionCharges.transactionId, ids.slice(i, i + 500))).all()) {
      charges.set(c.transactionId, [...(charges.get(c.transactionId) ?? []), c]);
    }
  }

  // Into the display currency at today's market rate (null when unknown).
  const show = (amount: DecimalValue, from: string): DecimalValue | null => {
    if (from === input.currency) return amount;
    const r = marketRate(db, from, input.currency);
    return r ? dec(convert(toDecimalString(amount), r.rate, input.currency)) : null;
  };

  const routes = new Map<string, { label: string; count: number; fees: DecimalValue; gap: DecimalValue; hasGap: boolean }>();
  let moved = new Decimal(0);
  let skipped = 0;

  for (const t of rows) {
    const from = t.accountId ? names.get(t.accountId) : undefined;
    const to = t.toAccountId ? names.get(t.toAccountId) : undefined;
    const receiving = t.kind === 'transfer' ? to?.currency : from?.currency;
    if (!receiving) continue;
    const key = t.kind === 'transfer' ? `t:${t.accountId}:${t.toAccountId}` : `${t.kind}:${t.currency}:${t.accountId}`;
    const label = t.kind === 'transfer' ? `${from?.name ?? ''} → ${to?.name ?? ''}` : t.kind === 'expense' ? `Card spend in ${t.currency}` : `${t.currency} income into ${from?.name ?? ''}`;

    // The part that was converted, in the main currency (before inside charges for income/transfers).
    const insideMain = (charges.get(t.id) ?? [])
      .filter((c) => c.deduction === 'already_deducted' && c.currency === t.currency)
      .reduce((s, c) => s.plus(dec(c.amount)), new Decimal(0));
    const converted = t.kind === 'expense' ? dec(t.amount) : dec(t.amount).minus(insideMain);

    let fees = new Decimal(0);
    let ok = true;
    for (const c of charges.get(t.id) ?? []) {
      if (c.isTax) continue;
      const v = show(dec(c.amount), c.currency);
      if (v === null) ok = false;
      else fees = fees.plus(v);
    }

    // Rate gap: what the market rate would have given, minus what the rate got gave, in the receiving currency.
    let gap = new Decimal(0);
    let hasGap = false;
    if (t.marketRateAtEntry) {
      const atMarket = converted.times(dec(t.marketRateAtEntry));
      const got = converted.times(dec(t.rate!));
      // For an expense, a higher rate costs more (you pay more of your currency); otherwise a lower rate does.
      const diff = t.kind === 'expense' ? got.minus(atMarket) : atMarket.minus(got);
      const v = show(diff, receiving);
      if (v === null) ok = false;
      else {
        gap = v;
        hasGap = true;
      }
    }
    const movedHere = show(converted, t.currency);
    if (movedHere === null || !ok) {
      skipped += 1;
      continue;
    }
    moved = moved.plus(movedHere);
    const r = routes.get(key) ?? { label, count: 0, fees: new Decimal(0), gap: new Decimal(0), hasGap: false };
    r.count += 1;
    r.fees = r.fees.plus(fees);
    r.gap = r.gap.plus(gap);
    r.hasGap = r.hasGap || hasGap;
    routes.set(key, r);
  }

  const round = (v: DecimalValue) => roundToMinor(v, input.currency);
  const list = [...routes].map(([key, r]) => ({
    key,
    label: r.label,
    count: r.count,
    fees: round(r.fees),
    rateGap: r.hasGap ? round(r.gap) : null,
    total: round(r.fees.plus(r.gap)),
  }));
  list.sort((a, b) => dec(b.total).comparedTo(dec(a.total)));
  const fees = list.reduce((s, r) => s.plus(dec(r.fees)), new Decimal(0));
  const gap = list.reduce((s, r) => s.plus(dec(r.rateGap ?? '0')), new Decimal(0));
  return {
    currency: input.currency,
    total: toDecimalString(fees.plus(gap)),
    fees: toDecimalString(fees),
    rateGap: toDecimalString(gap),
    moved: round(moved),
    routes: list,
    skipped,
  };
}
