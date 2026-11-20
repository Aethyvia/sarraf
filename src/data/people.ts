import { and, eq, isNull, or } from 'drizzle-orm';

import { people, personEntries, recurringItems, splitShares, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso } from '@/lib/dates';
import { newId } from '@/lib/id';
import { dec, toDecimalString } from '@/lib/money';
import { DataError, requireName } from './errors';
import {
  describeTransactions,
  hardDeleteTransactions,
  transactionIdsWhere,
  withLinkedChildren,
  type DeletionImpact,
} from './transaction-sets';

export type Person = typeof people.$inferSelect;

function getPerson(db: AppDb, id: string): Person {
  const person = db.select().from(people).where(eq(people.id, id)).get();
  if (!person) throw new DataError('not_found', `No person ${id}`);
  return person;
}

/** Add person = name + optional note. */
export function createPerson(db: AppDb, input: { name: string; note?: string | null }): string {
  const id = newId();
  db.insert(people)
    .values({ id, name: requireName(input.name), note: input.note?.trim() || null })
    .run();
  return id;
}

export function updatePerson(db: AppDb, id: string, changes: { name?: string; note?: string | null }): void {
  const values: Partial<typeof people.$inferInsert> = { updatedAt: nowIso() };
  if (changes.name !== undefined) values.name = requireName(changes.name);
  if (changes.note !== undefined) values.note = changes.note?.trim() || null;
  db.transaction((tx) => {
    getPerson(tx, id);
    tx.update(people).set(values).where(eq(people.id, id)).run();
  });
}

/**
 * Sets or clears a person's profile picture (owner, Nov 20). Returns the old
 * photo's path, if any, so the caller deletes that file after the save.
 */
export function setPersonPhoto(db: AppDb, id: string, photoPath: string | null): { removedPath: string | null } {
  return db.transaction((tx) => {
    const before = getPerson(tx, id).photoPath;
    tx.update(people).set({ photoPath, updatedAt: nowIso() }).where(eq(people.id, id)).run();
    return { removedPath: before && before !== photoPath ? before : null };
  });
}

export function archivePerson(db: AppDb, id: string): void {
  db.update(people).set({ archivedAt: nowIso(), updatedAt: nowIso() }).where(eq(people.id, id)).run();
}

export function unarchivePerson(db: AppDb, id: string): void {
  db.update(people).set({ archivedAt: null, updatedAt: nowIso() }).where(eq(people.id, id)).run();
}

/** Transfers to or from them, and expenses they paid for you: these go when the person is deleted. */
function owingTransactionIds(db: AppDb, id: string): string[] {
  return withLinkedChildren(
    db,
    transactionIdsWhere(db, or(eq(transactions.transferPersonId, id), eq(transactions.paidByPersonId, id))),
  );
}

export interface PersonDeletionImpact extends DeletionImpact {
  /** Splits they're in: only their share goes; the expense stays. */
  splits: number;
  /** Transactions where they're only tagged (or expected to pay back): these keep everything but the tag. */
  tagged: number;
}

export function personDeletionImpact(db: AppDb, id: string): PersonDeletionImpact {
  const owing = owingTransactionIds(db, id);
  const owingSet = new Set(owing);
  const splitTx = db
    .selectDistinct({ id: splitShares.transactionId })
    .from(splitShares)
    .where(eq(splitShares.personId, id))
    .all()
    .filter((r) => !owingSet.has(r.id));
  const tagged = transactionIdsWhere(
    db,
    and(
      or(eq(transactions.referencePersonId, id), eq(transactions.expectedFromPersonId, id)),
      isNull(transactions.deletedAt),
    ),
  ).filter((t) => !owingSet.has(t));
  return { ...describeTransactions(db, owing), splits: splitTx.length, tagged: tagged.length };
}

/**
 * Deletes a person (Decided Oct 21, owner Nov 7):
 * - transfers with them and expenses they paid are deleted (balances change);
 * - in a split you paid, their share becomes yours; in a split someone else paid,
 *   their untracked share row is just removed; the expense stays either way;
 * - settlements with them are deleted;
 * - where they're only tagged (or "expected back from"), the tag is cleared.
 */
export function deletePerson(db: AppDb, id: string): { attachmentPaths: string[] } {
  return db.transaction((tx) => {
    const photo = getPerson(tx, id).photoPath;
    const { attachmentPaths } = hardDeleteTransactions(tx, owingTransactionIds(tx, id));
    // Their profile picture goes with them.
    if (photo) attachmentPaths.push(photo);

    for (const share of tx.select().from(splitShares).where(eq(splitShares.personId, id)).all()) {
      const expense = tx.select().from(transactions).where(eq(transactions.id, share.transactionId)).get();
      const yours = tx
        .select()
        .from(splitShares)
        .where(and(eq(splitShares.transactionId, share.transactionId), isNull(splitShares.personId)))
        .get();
      if (expense && !expense.paidByPersonId && yours) {
        tx.update(splitShares)
          .set({
            shareAmount: toDecimalString(dec(yours.shareAmount).plus(dec(share.shareAmount))),
            // Percent and equal no longer describe the shares exactly; amounts do.
            splitMode: 'amounts',
            sharePercent: null,
            updatedAt: nowIso(),
          })
          .where(eq(splitShares.id, yours.id))
          .run();
        tx.update(splitShares)
          .set({ splitMode: 'amounts', sharePercent: null, updatedAt: nowIso() })
          .where(eq(splitShares.transactionId, share.transactionId))
          .run();
      }
      tx.delete(splitShares).where(eq(splitShares.id, share.id)).run();
    }

    tx.delete(personEntries).where(eq(personEntries.personId, id)).run();
    const untag = { updatedAt: nowIso() };
    tx.update(transactions).set({ ...untag, referencePersonId: null }).where(eq(transactions.referencePersonId, id)).run();
    tx.update(transactions)
      .set({ ...untag, expectedFromPersonId: null })
      .where(eq(transactions.expectedFromPersonId, id))
      .run();
    tx.update(recurringItems)
      .set({ ...untag, referencePersonId: null })
      .where(eq(recurringItems.referencePersonId, id))
      .run();
    tx.delete(people).where(eq(people.id, id)).run();
    return { attachmentPaths };
  });
}
