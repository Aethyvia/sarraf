import { and, eq, isNull } from 'drizzle-orm';

import { budgets, categories } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { monthOf, monthRange, nowIso, today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { Decimal, dec, isCurrencyCode, isDecimalString, toDecimalString, type DecimalString } from '@/lib/money';
import { DataError } from './errors';
import { flows } from './spending';

export type Budget = typeof budgets.$inferSelect;

export interface BudgetInput {
  ledgerId: string;
  /** Null: the whole ledger's spending ("All spending"), one cap per currency. */
  categoryId: string | null;
  currency: string;
  amount: DecimalString;
}

function check(db: AppDb, input: BudgetInput, exceptId?: string): void {
  if (!isCurrencyCode(input.currency)) throw new DataError('invalid_currency', 'Choose a currency');
  if (!isDecimalString(input.amount) || dec(input.amount).lte(0)) throw new DataError('invalid_amount', 'Enter an amount above zero');
  if (input.categoryId) {
    const cat = db.select().from(categories).where(eq(categories.id, input.categoryId)).get();
    if (!cat) throw new DataError('not_found', 'No category');
    if (cat.kind !== 'expense') throw new DataError('category_kind_mismatch', 'Budgets are for spending');
    if (cat.parentId) throw new DataError('category_depth', 'Budgets are set on a top-level category');
  }
  // One budget per ledger, category and currency.
  const clash = db
    .select()
    .from(budgets)
    .where(
      and(
        eq(budgets.ledgerId, input.ledgerId),
        eq(budgets.currency, input.currency),
        input.categoryId ? eq(budgets.categoryId, input.categoryId) : isNull(budgets.categoryId),
      ),
    )
    .all()
    .find((b) => b.id !== exceptId);
  if (clash) throw new DataError('invalid_target', 'That budget already exists');
}

/** Budgets are unlimited on every plan (Decided Nov 7). Monthly, no rollover. */
export function createBudget(db: AppDb, input: BudgetInput): string {
  check(db, input);
  const id = newId();
  const rank = db.select({ r: budgets.rank }).from(budgets).where(eq(budgets.ledgerId, input.ledgerId)).all().reduce((m, b) => Math.max(m, b.r + 1), 0);
  db.insert(budgets).values({ id, ...input, amount: toDecimalString(dec(input.amount)), period: 'monthly', rank }).run();
  return id;
}

export function updateBudget(db: AppDb, id: string, input: BudgetInput): void {
  check(db, input, id);
  db.update(budgets).set({ ...input, amount: toDecimalString(dec(input.amount)), updatedAt: nowIso() }).where(eq(budgets.id, id)).run();
}

export function deleteBudget(db: AppDb, id: string): void {
  db.delete(budgets).where(eq(budgets.id, id)).run();
}

export interface BudgetStatus {
  budget: Budget;
  spent: DecimalString;
  /** Cap − spent; negative when over. */
  left: DecimalString;
  /** Whole percent used, may pass 100. */
  percent: number;
  over: boolean;
}

/** Each budget of a ledger this month: what's been spent against it (same rules as Analytics). */
export function budgetStatuses(db: AppDb, ledgerId: string, asOf: string = todayDate()): BudgetStatus[] {
  const { from } = monthRange(monthOf(asOf));
  const list = db.select().from(budgets).where(eq(budgets.ledgerId, ledgerId)).orderBy(budgets.rank).all();
  const cache = new Map<string, ReturnType<typeof flows>>();
  const flowsFor = (currency: string) => cache.get(currency) ?? (cache.set(currency, flows(db, { currency, from, to: asOf, ledgerId })), cache.get(currency)!);
  return list.map((budget) => {
    const f = flowsFor(budget.currency);
    const spent = budget.categoryId ? (f.spending.find((x) => x.categoryId === budget.categoryId)?.amount ?? '0') : f.totalSpending;
    const left = dec(budget.amount).minus(dec(spent));
    const percent = dec(budget.amount).gt(0) ? Math.floor(dec(spent).dividedBy(dec(budget.amount)).times(100).toNumber()) : 0;
    return { budget, spent: toDecimalString(Decimal.max(dec(spent), 0)), left: toDecimalString(left), percent, over: left.isNegative() };
  });
}

/**
 * The budget warning on Add (Spec §11 — Decided): checks the category's budget
 * in the selected ledger only, in the paying account's currency. Shows when
 * this expense takes it over, or it's already over. No early warnings.
 */
export function budgetWarning(
  db: AppDb,
  input: { ledgerId: string | null; categoryId: string | null; currency: string; amount: DecimalString; date: string },
): { categoryId: string; cap: DecimalString; spent: DecimalString; after: DecimalString; alreadyOver: boolean } | null {
  if (!input.ledgerId || !input.categoryId || !isDecimalString(input.amount)) return null;
  const cat = db.select().from(categories).where(eq(categories.id, input.categoryId)).get();
  const topId = cat?.parentId ?? input.categoryId;
  const budget = db
    .select()
    .from(budgets)
    .where(and(eq(budgets.ledgerId, input.ledgerId), eq(budgets.categoryId, topId), eq(budgets.currency, input.currency)))
    .get();
  if (!budget) return null;
  const { from, to } = monthRange(monthOf(input.date));
  const spent = dec(flows(db, { currency: input.currency, from, to, ledgerId: input.ledgerId }).spending.find((x) => x.categoryId === topId)?.amount ?? '0');
  const after = spent.plus(dec(input.amount));
  const cap = dec(budget.amount);
  if (after.lte(cap) && spent.lte(cap)) return null;
  return { categoryId: topId, cap: budget.amount, spent: toDecimalString(spent), after: toDecimalString(after), alreadyOver: spent.gt(cap) };
}
