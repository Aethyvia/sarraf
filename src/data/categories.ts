import { and, count, eq, inArray, isNull, max } from 'drizzle-orm';

import { budgets, categories, recurringItems, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso } from '@/lib/dates';
import { newId } from '@/lib/id';
import { DataError, requireName } from './errors';
import {
  describeTransactions,
  hardDeleteTransactions,
  transactionIdsWhere,
  withLinkedChildren,
  type DeletionImpact,
} from './transaction-sets';

export type Category = typeof categories.$inferSelect;
export type CategoryKind = Category['kind'];

function getCategory(db: AppDb, id: string): Category {
  const category = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!category) throw new DataError('not_found', `No category ${id}`);
  return category;
}

function childrenOf(db: AppDb, id: string): Category[] {
  return db.select().from(categories).where(eq(categories.parentId, id)).all();
}

/** A parent must be a top-level category of the same kind (two levels only). */
function assertValidParent(db: AppDb, parentId: string, kind: CategoryKind, selfId?: string): void {
  if (parentId === selfId) throw new DataError('category_depth', 'A category cannot be its own parent');
  const parent = getCategory(db, parentId);
  if (parent.parentId) throw new DataError('category_depth', 'Categories have two levels only');
  if (parent.kind !== kind) throw new DataError('category_kind_mismatch', 'A subcategory has its parent’s kind');
  if (parent.archivedAt) throw new DataError('archived', 'Pick a parent that is not archived');
}

/** True while any transaction uses the category, which locks its kind. */
export function isCategoryInUse(db: AppDb, id: string): boolean {
  return (db.select({ n: count() }).from(transactions).where(eq(transactions.categoryId, id)).get()?.n ?? 0) > 0;
}

export interface NewCategory {
  name: string;
  kind: CategoryKind;
  parentId?: string | null;
  icon: string;
  color: string;
}

export function createCategory(db: AppDb, input: NewCategory): string {
  const name = requireName(input.name);
  const id = newId();
  db.transaction((tx) => {
    if (input.parentId) assertValidParent(tx, input.parentId, input.kind);
    const siblings = input.parentId ? eq(categories.parentId, input.parentId) : isNull(categories.parentId);
    const rank = (tx.select({ r: max(categories.rank) }).from(categories).where(siblings).get()?.r ?? -1) + 1;
    tx.insert(categories)
      .values({ id, name, kind: input.kind, parentId: input.parentId ?? null, icon: input.icon, color: input.color, rank })
      .run();
  });
  return id;
}

export interface CategoryChanges {
  name?: string;
  icon?: string;
  color?: string;
  /** Switching kind is allowed only while no transaction uses the category (or its subcategories). */
  kind?: CategoryKind;
  /** null makes it top-level. */
  parentId?: string | null;
}

export function updateCategory(db: AppDb, id: string, changes: CategoryChanges): void {
  db.transaction((tx) => {
    const category = getCategory(tx, id);
    const values: Partial<typeof categories.$inferInsert> = { updatedAt: nowIso() };
    if (changes.name !== undefined) values.name = requireName(changes.name);
    if (changes.icon !== undefined) values.icon = changes.icon;
    if (changes.color !== undefined) values.color = changes.color;

    const kind = changes.kind ?? category.kind;
    const parentId = changes.parentId === undefined ? category.parentId : changes.parentId;
    const children = childrenOf(tx, id);

    if (kind !== category.kind) {
      if (category.isSystem) throw new DataError('system_category', 'Fees & charges is always an expense category');
      if ([category, ...children].some((c) => isCategoryInUse(tx, c.id))) {
        throw new DataError('category_kind_locked', 'Transactions use this category, so its kind is locked');
      }
      values.kind = kind;
    }
    if (parentId !== category.parentId) {
      if (parentId !== null) {
        if (category.isSystem) throw new DataError('system_category', 'Fees & charges stays a top-level category');
        if (children.length > 0) throw new DataError('category_depth', 'A category with subcategories stays top-level');
        assertValidParent(tx, parentId, kind, id);
      }
      values.parentId = parentId;
    } else if (parentId !== null && kind !== category.kind) {
      // Still under the same parent: its kind must keep matching the parent's.
      assertValidParent(tx, parentId, kind, id);
    }

    tx.update(categories).set(values).where(eq(categories.id, id)).run();
    if (values.kind && children.length > 0) {
      tx.update(categories)
        .set({ kind: values.kind, updatedAt: nowIso() })
        .where(inArray(categories.id, children.map((c) => c.id)))
        .run();
    }
  });
}

export function archiveCategory(db: AppDb, id: string): void {
  db.transaction((tx) => {
    const category = getCategory(tx, id);
    if (category.isSystem) throw new DataError('system_category', 'Fees & charges can be renamed but not removed');
    tx.update(categories).set({ archivedAt: nowIso(), updatedAt: nowIso() }).where(eq(categories.id, id)).run();
  });
}

export function unarchiveCategory(db: AppDb, id: string): void {
  db.update(categories).set({ archivedAt: null, updatedAt: nowIso() }).where(eq(categories.id, id)).run();
}

function categoryTransactionIds(db: AppDb, id: string): string[] {
  return withLinkedChildren(db, transactionIdsWhere(db, eq(transactions.categoryId, id)));
}

export function categoryDeletionImpact(db: AppDb, id: string): DeletionImpact {
  return describeTransactions(db, categoryTransactionIds(db, id));
}

export type CategoryDeletion =
  /** Move its transactions, budgets and recurring items to another category of the same kind, then delete. */
  | { mode: 'move'; targetCategoryId: string }
  /** Delete it with its transactions (balances change), budgets and recurring items. */
  | { mode: 'delete_with_transactions' };

/**
 * Deletes a category. A category with subcategories must have them moved or
 * deleted first. Fees & charges can never be deleted. "Archive" is archiveCategory().
 */
export function deleteCategory(db: AppDb, id: string, how: CategoryDeletion): { attachmentPaths: string[] } {
  return db.transaction((tx) => {
    const category = getCategory(tx, id);
    if (category.isSystem) throw new DataError('system_category', 'Fees & charges can be renamed but not deleted');
    if (childrenOf(tx, id).length > 0) {
      throw new DataError('has_subcategories', 'Move or delete its subcategories first');
    }

    let attachmentPaths: string[] = [];
    if (how.mode === 'move') {
      if (how.targetCategoryId === id) throw new DataError('invalid_target', 'Pick a different category');
      const target = getCategory(tx, how.targetCategoryId);
      if (target.kind !== category.kind) throw new DataError('category_kind_mismatch', 'Pick a category of the same kind');
      if (target.archivedAt) throw new DataError('archived', 'Pick a category that is not archived');
      const moved = { categoryId: target.id, updatedAt: nowIso() };
      tx.update(transactions).set(moved).where(eq(transactions.categoryId, id)).run();
      tx.update(recurringItems).set(moved).where(eq(recurringItems.categoryId, id)).run();
      // A budget whose ledger and currency the target already budgets is dropped, not duplicated.
      for (const b of tx.select().from(budgets).where(eq(budgets.categoryId, id)).all()) {
        const clash = tx
          .select({ id: budgets.id })
          .from(budgets)
          .where(and(eq(budgets.categoryId, target.id), eq(budgets.ledgerId, b.ledgerId), eq(budgets.currency, b.currency)))
          .get();
        if (clash) tx.delete(budgets).where(eq(budgets.id, b.id)).run();
        else tx.update(budgets).set(moved).where(eq(budgets.id, b.id)).run();
      }
    } else {
      attachmentPaths = hardDeleteTransactions(tx, categoryTransactionIds(tx, id)).attachmentPaths;
      tx.delete(recurringItems).where(eq(recurringItems.categoryId, id)).run();
      tx.delete(budgets).where(eq(budgets.categoryId, id)).run();
    }
    tx.delete(categories).where(eq(categories.id, id)).run();
    return { attachmentPaths };
  });
}

/** Custom order among siblings (same parent). */
export function reorderCategories(db: AppDb, orderedIds: string[]): void {
  db.transaction((tx) => {
    orderedIds.forEach((id, rank) => {
      tx.update(categories).set({ rank, updatedAt: nowIso() }).where(eq(categories.id, id)).run();
    });
  });
}

/** The built-in Fees & charges category, where non-tax charges count in Analytics and Budgets. */
export function feesCategoryId(db: AppDb): string {
  const row = db.select({ id: categories.id }).from(categories).where(and(eq(categories.isSystem, true))).get();
  if (!row) throw new DataError('not_found', 'Fees & charges is missing');
  return row.id;
}
