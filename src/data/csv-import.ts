import { and, desc, eq, isNull } from 'drizzle-orm';

import { accounts, categories, importPresets, ledgers, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { addDays, today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { Decimal, dec, isDecimalString, roundToMinor, toDecimalString, type DecimalString } from '@/lib/money';
import { saveTransaction } from './transactions';

/**
 * CSV import (Spec — Decided): one account per file. Columns are mapped once
 * and remembered by the header row ("Recognised: Payoneer statement"). Every
 * row is reviewed before anything is saved.
 */

export type Field = 'date' | 'amount' | 'debit' | 'credit' | 'notes' | 'category' | 'ignore';
export type DateFormat = 'ymd' | 'dmy' | 'mdy' | 'text';

export interface Mapping {
  columns: Field[];
  dateFormat: DateFormat;
}

export const signatureOf = (header: string[]) => header.map((h) => h.trim().toLowerCase()).join('|');

/** A first guess from the header names. */
export function guessMapping(header: string[]): Field[] {
  const used = new Set<Field>();
  return header.map((raw) => {
    const h = raw.toLowerCase();
    const pick = (f: Field) => (used.has(f) ? 'ignore' : (used.add(f), f));
    if (/date|posted|when/.test(h)) return pick('date');
    if (/debit|withdraw|paid out|money out|\bout\b/.test(h)) return pick('debit');
    if (/credit|deposit|paid in|money in|\bin\b/.test(h)) return pick('credit');
    if (/amount|sum|value|total/.test(h)) return pick('amount');
    if (/categ/.test(h)) return pick('category');
    if (/memo|desc|detail|narration|note|payee|merchant|reference|particular/.test(h)) return pick('notes');
    return 'ignore';
  });
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseDate(raw: string, format: DateFormat): string | null {
  const s = raw.trim().split(/[ T]/).length > 1 && format !== 'text' ? raw.trim().split(/[ T]/)[0] : raw.trim();
  if (format === 'text') {
    const m = s.toLowerCase().match(/^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-,]+(\d{2,4})$|^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2,4})$/);
    if (!m) return null;
    return m[1] ? iso(Number(m[3]), MONTHS.indexOf(m[2]) + 1, Number(m[1])) : iso(Number(m[6]), MONTHS.indexOf(m[4]) + 1, Number(m[5]));
  }
  const parts = s.split(/[./-]/).map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
  const [a, b, c] = parts;
  if (format === 'ymd') return a > 31 ? iso(a, b, c) : null;
  if (format === 'dmy') return iso(c, b, a);
  return iso(c, a, b);
}

/** The date formats that read every value in the column (the person picks when more than one fits). */
export function dateFormatsFor(values: string[]): DateFormat[] {
  const all: DateFormat[] = ['ymd', 'text', 'dmy', 'mdy'];
  const filled = values.filter((v) => v.trim());
  return all.filter((f) => filled.length > 0 && filled.every((v) => parseDate(v, f) !== null));
}

/** Reads "1,234.56", "1.234,56", "(15.00)", "-15", "$15.00", "15.00 CR/DR". Null when it isn't a number. */
export function parseAmount(raw: string): DecimalString | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\bdr\b/i.test(s)) negative = true;
  s = s.replace(/\b(cr|dr)\b/gi, '').replace(/[^\d.,\-−+]/g, '');
  if (/^[-−]/.test(s) || /[-−]$/.test(s)) negative = !negative;
  s = s.replace(/[-−+]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastComma >= 0) s = /,\d{1,2}$/.test(s) && s.split(',').length === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  if (!isDecimalString(s)) return null;
  return toDecimalString(negative ? dec(s).negated() : dec(s));
}

export interface PreviewRow {
  line: number;
  date: string | null;
  /** Signed: negative is money out (expense), positive money in (income). */
  amount: DecimalString | null;
  notes: string;
  categoryId: string | null;
  categoryFrom: 'column' | 'history' | null;
  duplicateOf: string | null;
  error: 'date' | 'amount' | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** "ADOBE *CREATIVE CL" and "Adobe Creative Cloud" share their first word. */
const firstWords = (s: string) => norm(s).split(' ').slice(0, 2).join(' ');

/** Builds the review list: parsed values, a category (by column name or past entries), and likely duplicates. */
export function previewImport(db: AppDb, input: { accountId: string; rows: string[][]; mapping: Mapping }): PreviewRow[] {
  const account = db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
  if (!account) throw new Error('No account');
  const cats = db.select().from(categories).all();
  const byName = new Map(cats.map((c) => [norm(c.name), c.id]));
  const past = db
    .select({ notes: transactions.notes, categoryId: transactions.categoryId })
    .from(transactions)
    .where(and(eq(transactions.accountId, input.accountId), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.date))
    .all();
  const learned = new Map<string, string>();
  for (const p of past) if (p.notes && p.categoryId && !learned.has(firstWords(p.notes))) learned.set(firstWords(p.notes), p.categoryId);
  const existing = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.accountId, input.accountId)))
    .all();
  const col = (f: Field) => input.mapping.columns.indexOf(f);

  return input.rows.map((r, i) => {
    const get = (f: Field) => (col(f) >= 0 ? (r[col(f)] ?? '').trim() : '');
    const date = parseDate(get('date'), input.mapping.dateFormat);
    let amount: DecimalString | null = null;
    if (col('amount') >= 0) amount = parseAmount(get('amount'));
    else {
      const out = parseAmount(get('debit'));
      const inn = parseAmount(get('credit'));
      if (out && !dec(out).isZero()) amount = toDecimalString(dec(out).abs().negated());
      else if (inn) amount = toDecimalString(dec(inn).abs());
    }
    if (amount) amount = roundToMinor(dec(amount), account.currency);
    const notes = get('notes');
    let categoryId: string | null = null;
    let categoryFrom: PreviewRow['categoryFrom'] = null;
    const named = get('category');
    if (named && byName.has(norm(named))) {
      categoryId = byName.get(norm(named))!;
      categoryFrom = 'column';
    } else if (notes && learned.has(firstWords(notes))) {
      categoryId = learned.get(firstWords(notes))!;
      categoryFrom = 'history';
    }
    // The same day and amount already in this account: probably the same charge.
    const dup =
      date && amount
        ? existing.find((t) => t.date === date && t.kind !== 'opening_balance' && dec(t.accountAmount ?? t.amount).eq(dec(amount!).abs()) && (dec(amount!).isNegative() ? t.kind === 'expense' : t.kind === 'income'))
        : undefined;
    // Keep categories that fit the direction.
    if (categoryId && amount) {
      const kind = dec(amount).isNegative() ? 'expense' : 'income';
      if (cats.find((c) => c.id === categoryId)?.kind !== kind) {
        categoryId = null;
        categoryFrom = null;
      }
    }
    return {
      line: i + 2,
      date,
      amount,
      notes,
      categoryId,
      categoryFrom,
      duplicateOf: dup?.id ?? null,
      error: !date ? 'date' : !amount || dec(amount).isZero() ? 'amount' : null,
    };
  });
}

/**
 * Older history moves the opening balance (Spec, Nov 7): rows dated before it
 * push it to the day before the earliest one, and its amount becomes the
 * entered balance minus those rows, so today's balance stays as typed.
 */
export function openingShift(db: AppDb, accountId: string, rows: Pick<PreviewRow, 'date' | 'amount'>[]): { id: string; from: { date: string; amount: DecimalString }; to: { date: string; amount: DecimalString } } | null {
  const opening = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), eq(transactions.kind, 'opening_balance'), isNull(transactions.deletedAt)))
    .get();
  if (!opening) return null;
  const older = rows.filter((r) => r.date && r.amount && r.date < opening.date);
  if (!older.length) return null;
  const earliest = older.map((r) => r.date!).sort()[0];
  const sum = older.reduce((s, r) => s.plus(dec(r.amount!)), new Decimal(0));
  const current = opening.accountAmount ?? opening.amount;
  return { id: opening.id, from: { date: opening.date, amount: current }, to: { date: addDays(earliest, -1), amount: toDecimalString(dec(current).minus(sum)) } };
}

/** Saves the confirmed rows (Cleared, in the default ledger unless given), the opening shift, and the mapping. */
export function commitImport(
  db: AppDb,
  input: { accountId: string; ledgerId?: string | null; rows: PreviewRow[]; header: string[]; mapping: Mapping; presetName: string; today?: string },
): { added: number; batchId: string } {
  const account = db.select().from(accounts).where(eq(accounts.id, input.accountId)).get()!;
  const ledgerId = input.ledgerId ?? db.select().from(ledgers).where(eq(ledgers.isDefault, true)).get()?.id ?? null;
  const batchId = newId();
  const good = input.rows.filter((r) => !r.error && r.date && r.amount);
  const shift = openingShift(db, input.accountId, good);
  db.transaction((tx) => {
    for (const r of good) {
      const out = dec(r.amount!).isNegative();
      const { id } = saveTransaction(
        tx,
        {
          kind: out ? 'expense' : 'income',
          date: r.date!,
          status: 'cleared',
          ledgerId,
          accountId: input.accountId,
          amount: toDecimalString(dec(r.amount!).abs()),
          currency: account.currency,
          categoryId: r.categoryId,
          notes: r.notes || null,
        },
        { today: input.today ?? todayDate() },
      );
      tx.update(transactions).set({ importBatchId: batchId }).where(eq(transactions.id, id)).run();
    }
    if (shift) tx.update(transactions).set({ date: shift.to.date, amount: shift.to.amount, accountAmount: shift.to.amount }).where(eq(transactions.id, shift.id)).run();
    const signature = signatureOf(input.header);
    const preset = tx.select().from(importPresets).where(eq(importPresets.headerSignature, signature)).get();
    if (preset) tx.update(importPresets).set({ columnMap: input.mapping }).where(eq(importPresets.id, preset.id)).run();
    else tx.insert(importPresets).values({ id: newId(), name: input.presetName, headerSignature: signature, columnMap: input.mapping }).run();
  });
  return { added: good.length, batchId };
}

/** A saved mapping for these headers, if any ("Recognised: … Your saved mapping was applied"). */
export function savedMapping(db: AppDb, header: string[]): { name: string; mapping: Mapping } | null {
  const p = db.select().from(importPresets).where(eq(importPresets.headerSignature, signatureOf(header))).get();
  return p ? { name: p.name, mapping: p.columnMap as Mapping } : null;
}
