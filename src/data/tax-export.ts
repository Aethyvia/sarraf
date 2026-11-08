import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';

import { accounts, categories, ledgers, taxExports, transactionCharges, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { addDays } from '@/lib/dates';
import { toCsv } from '@/lib/csv';
import { newId } from '@/lib/id';
import { Decimal, dec, toDecimalString, type DecimalString, type DecimalValue } from '@/lib/money';
import { forEachMovement } from './balances';
import { transactionsCsv } from './export';
import { flows } from './spending';

export interface TaxRange {
  from: string;
  to: string;
}

/** The fiscal year containing `day` (Tax export always uses the fiscal year). */
export function fiscalYearOf(day: string, startMonth: number): TaxRange {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const startYear = m >= startMonth ? y : y - 1;
  const from = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  const next = startMonth === 1 ? `${startYear + 1}-01-01` : `${startYear + 1}-${String(startMonth).padStart(2, '0')}-01`;
  return { from, to: addDays(next, -1) };
}

export interface CurrencyTax {
  currency: string;
  /** Income before anything was taken off (Spec: income counts before deductions). */
  grossIncome: DecimalString;
  /** Spending, with refunds and reimbursements taken off; non-tax fees included. */
  expenses: DecimalString;
  /** Charges marked "This is tax": a credit against tax owed. */
  taxWithheld: DecimalString;
}

/**
 * Tax export summary (TaxExport board): per currency, never combined —
 * converting to one number would hide what was actually received. All ledgers
 * unless one is picked. Same rules as Analytics.
 */
export function taxSummary(db: AppDb, range: TaxRange, ledgerId: string | null = null): CurrencyTax[] {
  const currencies = new Set(db.select({ c: accounts.currency }).from(accounts).all().map((a) => a.c));
  const taxes = new Map<string, DecimalValue>();
  for (const c of db
    .select({ amount: transactionCharges.amount, currency: transactionCharges.currency, ledgerId: transactions.ledgerId })
    .from(transactionCharges)
    .innerJoin(transactions, eq(transactions.id, transactionCharges.transactionId))
    .where(and(isNull(transactions.deletedAt), eq(transactions.status, 'cleared'), eq(transactions.scheduled, false), eq(transactionCharges.isTax, true), gte(transactions.date, range.from), lte(transactions.date, range.to)))
    .all()) {
    if (ledgerId && c.ledgerId !== ledgerId) continue;
    currencies.add(c.currency);
    taxes.set(c.currency, (taxes.get(c.currency) ?? new Decimal(0)).plus(dec(c.amount)));
  }
  return [...currencies]
    .map((currency) => {
      const f = flows(db, { currency, from: range.from, to: range.to, ledgerId });
      return { currency, grossIncome: f.totalIncome, expenses: f.totalSpending, taxWithheld: toDecimalString(taxes.get(currency) ?? new Decimal(0)) };
    })
    .filter((r) => !dec(r.grossIncome).isZero() || !dec(r.expenses).isZero() || !dec(r.taxWithheld).isZero());
}

/** all-transactions.csv: every Cleared income and expense in the year, with account and ledger; transfers left out. */
export function taxTransactionsCsv(db: AppDb, range: TaxRange, ledgerId: string | null): string {
  return transactionsCsv(db, { from: range.from, to: range.to, ledgerId }, (t) => t.status === 'cleared' && !t.scheduled && (t.kind === 'income' || t.kind === 'expense'));
}

/** conversions.csv: each transfer between currencies with both amounts (e.g. USD → PKR). */
export function conversionsCsv(db: AppDb, range: TaxRange): string {
  const acc = new Map(db.select().from(accounts).all().map((a) => [a.id, a]));
  const rows = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.status, 'cleared'), eq(transactions.kind, 'transfer'), gte(transactions.date, range.from), lte(transactions.date, range.to)))
    .orderBy(transactions.date)
    .all()
    .filter((t) => t.accountId && t.toAccountId && acc.get(t.accountId)?.currency !== acc.get(t.toAccountId)?.currency);
  return toCsv(
    ['date', 'from_account', 'sent', 'sent_currency', 'to_account', 'received', 'received_currency', 'rate', 'market_rate_at_entry', 'notes'],
    rows.map((t) => {
      const from = acc.get(t.accountId!)!;
      const to = acc.get(t.toAccountId!)!;
      return [t.date, from.name, t.accountAmount ?? t.amount, from.currency, to.name, t.toAmount ?? '', to.currency, t.rate ?? '', t.marketRateAtEntry ?? '', t.notes ?? ''];
    }),
  );
}

/** accounts/<name>.csv: every movement in the account over the year, with the running balance. */
export function accountCsvs(db: AppDb, range: TaxRange): { name: string; csv: string }[] {
  const acc = db.select().from(accounts).all();
  const txs = new Map(db.select().from(transactions).all().map((t) => [t.id, t]));
  const cats = new Map(db.select().from(categories).all().map((c) => [c.id, c.name]));
  const start = new Map<string, DecimalValue>();
  const moves = new Map<string, { date: string; delta: DecimalValue; id: string; charge: boolean }[]>();
  forEachMovement(db, range.to, (accountId, date, delta, src) => {
    if (date < range.from) start.set(accountId, (start.get(accountId) ?? new Decimal(0)).plus(delta));
    else moves.set(accountId, [...(moves.get(accountId) ?? []), { date, delta: dec(delta.toString()), id: src.transactionId, charge: src.charge }]);
  });
  const used = new Set<string>();
  return acc
    .filter((a) => moves.has(a.id) || start.has(a.id))
    .map((a) => {
      let bal = start.get(a.id) ?? new Decimal(0);
      const list = (moves.get(a.id) ?? []).sort((x, y) => x.date.localeCompare(y.date));
      const rows: unknown[][] = [[range.from, 'Balance at start', '', '', '', toDecimalString(bal)]];
      for (const m of list) {
        bal = bal.plus(m.delta);
        const t = txs.get(m.id);
        const what = m.charge ? 'Charge' : (t?.notes?.split('\n')[0] ?? (t?.categoryId ? cats.get(t.categoryId) : null) ?? t?.kind ?? '');
        rows.push([m.date, what, t?.kind ?? '', m.delta.isNegative() ? '' : toDecimalString(m.delta), m.delta.isNegative() ? toDecimalString(m.delta.abs()) : '', toDecimalString(bal)]);
      }
      let file = a.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Account';
      while (used.has(file)) file += ' (2)';
      used.add(file);
      return { name: `${file} ${a.currency}.csv`.replace(` ${a.currency} ${a.currency}`, ` ${a.currency}`), csv: toCsv(['date', 'description', 'kind', 'in', 'out', 'balance'], rows) };
    });
}

/** The zip: summary.pdf (made by the caller), all-transactions.csv, conversions.csv, accounts/. */
export function buildTaxZip(db: AppDb, range: TaxRange, ledgerId: string | null, summaryPdf: Uint8Array | null): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'all-transactions.csv': strToU8(taxTransactionsCsv(db, range, ledgerId)),
    'conversions.csv': strToU8(conversionsCsv(db, range)),
  };
  if (summaryPdf) files['summary.pdf'] = summaryPdf;
  for (const a of accountCsvs(db, range)) files[`accounts/${a.name}`] = strToU8(a.csv);
  return zipSync(files);
}

/** Records the exported year, for "This changes October, which you exported". */
export function recordTaxExport(db: AppDb, range: TaxRange, at: string): void {
  db.insert(taxExports).values({ id: newId(), fiscalYearStart: range.from, fiscalYearEnd: range.to, exportedAt: at }).run();
}

/** Editing a transaction in an exported year: the month to warn about, or null. */
export function exportedPeriodFor(db: AppDb, date: string): string | null {
  const hit = db.select().from(taxExports).all().find((e) => date >= e.fiscalYearStart && date <= e.fiscalYearEnd);
  if (!hit) return null;
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
}

export function ledgerName(db: AppDb, id: string | null): string | null {
  return id ? (db.select({ n: ledgers.name }).from(ledgers).where(eq(ledgers.id, id)).get()?.n ?? null) : null;
}
