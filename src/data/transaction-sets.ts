import { and, inArray, isNotNull, type SQL } from 'drizzle-orm';

import { accounts, attachments, people, personEntries, transactionCharges, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';

/** What deleting a set of transactions would do; shown on the delete-in-use sheet. */
export interface DeletionImpact {
  /** Transactions the user can see (not already soft-deleted) that would go. */
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Accounts, other than the one being deleted, whose balance would change. */
  otherAccounts: { id: string; name: string }[];
  /** People whose balance with you would change. */
  people: { id: string; name: string }[];
}

const CHUNK = 500;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** Adds every refund / reimbursement linked under the given transactions (they go with their original). */
export function withLinkedChildren(db: AppDb, ids: string[]): string[] {
  const all = new Set(ids);
  let frontier = ids;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const part of chunks(frontier)) {
      for (const row of db
        .select({ id: transactions.id })
        .from(transactions)
        .where(inArray(transactions.parentId, part))
        .all()) {
        if (!all.has(row.id)) {
          all.add(row.id);
          next.push(row.id);
        }
      }
    }
    frontier = next;
  }
  return [...all];
}

export function describeTransactions(db: AppDb, ids: string[], exceptAccountId?: string): DeletionImpact {
  let count = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  const accountIds = new Set<string>();
  const personIds = new Set<string>();

  for (const part of chunks(ids)) {
    const rows = db
      .select({
        date: transactions.date,
        deletedAt: transactions.deletedAt,
        accountId: transactions.accountId,
        toAccountId: transactions.toAccountId,
      })
      .from(transactions)
      .where(inArray(transactions.id, part))
      .all();
    for (const r of rows) {
      if (r.accountId) accountIds.add(r.accountId);
      if (r.toAccountId) accountIds.add(r.toAccountId);
      if (r.deletedAt) continue;
      count += 1;
      if (firstDate === null || r.date < firstDate) firstDate = r.date;
      if (lastDate === null || r.date > lastDate) lastDate = r.date;
    }
    for (const c of db
      .select({ accountId: transactionCharges.accountId })
      .from(transactionCharges)
      .where(and(inArray(transactionCharges.transactionId, part), isNotNull(transactionCharges.accountId)))
      .all()) {
      accountIds.add(c.accountId!);
    }
    for (const e of db
      .select({ personId: personEntries.personId })
      .from(personEntries)
      .where(inArray(personEntries.transactionId, part))
      .all()) {
      personIds.add(e.personId);
    }
  }
  if (exceptAccountId) accountIds.delete(exceptAccountId);

  const named = <T extends { id: string; name: string }>(rows: T[]) =>
    rows.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    count,
    firstDate,
    lastDate,
    otherAccounts: accountIds.size
      ? named(db.select().from(accounts).where(inArray(accounts.id, [...accountIds])).all())
      : [],
    people: personIds.size ? named(db.select().from(people).where(inArray(people.id, [...personIds])).all()) : [],
  };
}

/**
 * Permanently deletes transactions with their charges, split shares, person
 * entries and attachment rows. Use inside a transaction. Returns the attachment
 * file paths so the caller can remove the files.
 */
export function hardDeleteTransactions(db: AppDb, ids: string[]): { attachmentPaths: string[] } {
  const attachmentPaths: string[] = [];
  for (const part of chunks(ids)) {
    for (const a of db
      .select({ filePath: attachments.filePath })
      .from(attachments)
      .where(inArray(attachments.transactionId, part))
      .all()) {
      attachmentPaths.push(a.filePath);
    }
    // Unlink parents first: every row in the set goes, and parent_id is ON DELETE RESTRICT.
    db.update(transactions)
      .set({ parentId: null, linkType: null })
      .where(and(inArray(transactions.id, part), isNotNull(transactions.parentId)))
      .run();
  }
  for (const part of chunks(ids)) {
    db.delete(transactions).where(inArray(transactions.id, part)).run();
  }
  return { attachmentPaths };
}

/** Ids of transactions (including soft-deleted ones) matching a condition on the transactions table. */
export function transactionIdsWhere(db: AppDb, where: SQL | undefined): string[] {
  return db
    .select({ id: transactions.id })
    .from(transactions)
    .where(where)
    .all()
    .map((r) => r.id);
}
