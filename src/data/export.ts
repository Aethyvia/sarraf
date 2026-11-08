import { and, eq, getTableColumns, getTableName, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { accounts, categories, ledgers, people, transactionCharges, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { toCsv } from '@/lib/csv';
import { BACKUP_FORMAT, TABLES, type Snapshot } from './backup-file';

export interface ExportFilter {
  ledgerId?: string | null;
  from?: string | null;
  to?: string | null;
}

const JSON_MAGIC = 'SARRAF-JSON';

function txWhere(f: ExportFilter): SQL | undefined {
  return and(
    isNull(transactions.deletedAt),
    f.ledgerId ? eq(transactions.ledgerId, f.ledgerId) : undefined,
    f.from ? gte(transactions.date, f.from) : undefined,
    f.to ? lte(transactions.date, f.to) : undefined,
  );
}

function names(db: AppDb) {
  const map = <T extends { id: string; name: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r.name]));
  const cats = db.select().from(categories).all();
  return {
    account: map(db.select({ id: accounts.id, name: accounts.name }).from(accounts).all()),
    ledger: map(db.select({ id: ledgers.id, name: ledgers.name }).from(ledgers).all()),
    person: map(db.select({ id: people.id, name: people.name }).from(people).all()),
    category: new Map(cats.map((c) => [c.id, c])),
  };
}

export const CSV_HEADER = [
  'id',
  'date',
  'kind',
  'status',
  'ledger',
  'account',
  'to_account',
  'person',
  'amount',
  'currency',
  'account_amount',
  'rate',
  'to_amount',
  'category',
  'subcategory',
  'notes',
  'linked_to',
  'link_type',
  'charges',
];

/**
 * Export data → CSV (DataExport board): every transaction exactly as stored,
 * one row each, with its charges listed in the last column. Nothing summarised.
 * Refunds and reimbursements are listed on their own date (Decided Nov 7).
 */
export function transactionsCsv(db: AppDb, f: ExportFilter = {}, only?: (t: typeof transactions.$inferSelect) => boolean): string {
  const n = names(db);
  const rows = db
    .select()
    .from(transactions)
    .where(txWhere(f))
    .orderBy(transactions.date, transactions.createdAt)
    .all()
    .filter((t) => !only || only(t));
  const charges = new Map<string, (typeof transactionCharges.$inferSelect)[]>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    for (const c of db.select().from(transactionCharges).where(inArray(transactionCharges.transactionId, ids.slice(i, i + 500))).all()) {
      charges.set(c.transactionId, [...(charges.get(c.transactionId) ?? []), c]);
    }
  }
  const out = rows.map((t) => {
    const cat = t.categoryId ? n.category.get(t.categoryId) : undefined;
    const parent = cat?.parentId ? n.category.get(cat.parentId) : undefined;
    const person = t.transferPersonId ?? t.paidByPersonId ?? t.referencePersonId;
    return [
      t.id,
      t.date,
      t.kind,
      t.status,
      n.ledger.get(t.ledgerId ?? '') ?? '',
      n.account.get(t.accountId ?? '') ?? '',
      n.account.get(t.toAccountId ?? '') ?? '',
      person ? (n.person.get(person) ?? '') : '',
      t.amount,
      t.currency,
      t.accountAmount ?? '',
      t.rate ?? '',
      t.toAmount ?? '',
      parent ? parent.name : (cat?.name ?? ''),
      parent ? cat?.name : '',
      t.notes ?? '',
      t.parentId ?? '',
      t.linkType ?? '',
      (charges.get(t.id) ?? [])
        .map((c) => `${c.label ?? c.type} ${c.amount} ${c.currency} ${c.deduction === 'already_deducted' ? 'inside' : 'on top'}${c.isTax ? ' tax' : ''}`)
        .join('; '),
    ];
  });
  return toCsv(CSV_HEADER, out);
}

/**
 * Export data → JSON: Sarraf's own file (format version inside). Everything
 * except this phone's settings; the transaction filter applies to
 * transactions and what hangs off them.
 */
export function sarrafJson(db: AppDb, f: ExportFilter = {}, exportedAt = new Date().toISOString()): string {
  const keep = new Set(db.select({ id: transactions.id }).from(transactions).where(txWhere(f)).all().map((r) => r.id));
  const data: Snapshot = {};
  for (const t of TABLES) {
    if (t === schema.settings) continue;
    let rows = db.select().from(t).all() as Record<string, unknown>[];
    const cols = getTableColumns(t);
    if (t === transactions) rows = rows.filter((r) => keep.has(r.id as string));
    else if ('transactionId' in cols) rows = rows.filter((r) => r.transactionId === null || keep.has(r.transactionId as string));
    data[getTableName(t)] = rows;
  }
  return JSON.stringify({ magic: JSON_MAGIC, format: BACKUP_FORMAT, exportedAt, data });
}

export class ImportFileError extends Error {}

/** The key a row is matched on: its permanent id (or the natural key of the two id-less tables). */
function keyOf(table: string, row: Record<string, unknown>): string {
  if (table === 'currency_order') return String(row.currency);
  if (table === 'market_rates') return `${row.base}/${row.quote}`;
  return String(row.id);
}

/**
 * Sarraf JSON import (Spec — Decided): adds rows whose id is missing and never
 * overwrites one that exists. One transaction; a file that would break links
 * changes nothing. Newer files are refused with a message to update.
 */
export function importSarrafJson(db: AppDb, text: string): { added: number; skipped: number } {
  let file: { magic?: string; format?: number; data?: Snapshot };
  try {
    file = JSON.parse(text);
  } catch {
    throw new ImportFileError('This file isn’t a Sarraf export.');
  }
  if (file.magic !== JSON_MAGIC || !file.data) throw new ImportFileError('This file isn’t a Sarraf export.');
  if ((file.format ?? 0) > BACKUP_FORMAT) throw new ImportFileError('This file was made by a newer Sarraf. Update the app to import it.');
  let added = 0;
  let skipped = 0;
  db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    db.transaction((tx) => {
      for (const t of TABLES) {
        if (t === schema.settings) continue;
        const name = getTableName(t);
        const rows = file.data![name] ?? [];
        if (!rows.length) continue;
        const known = Object.keys(getTableColumns(t));
        const have = new Set((tx.select().from(t).all() as Record<string, unknown>[]).map((r) => keyOf(name, r)));
        const fresh = rows
          .filter((r) => {
            const missing = !have.has(keyOf(name, r));
            if (!missing) skipped += 1;
            return missing;
          })
          .map((r) => Object.fromEntries(known.filter((k) => k in r).map((k) => [k, r[k]])));
        for (let i = 0; i < fresh.length; i += 200) tx.insert(t).values(fresh.slice(i, i + 200)).run();
        added += fresh.length;
      }
      if (tx.all(sql`PRAGMA foreign_key_check`).length) throw new ImportFileError('This file refers to things that aren’t in it or on this phone, so nothing was imported.');
    });
  } finally {
    db.run(sql`PRAGMA foreign_keys = ON`);
  }
  return { added, skipped };
}
