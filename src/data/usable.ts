import { and, eq, isNull, ne } from 'drizzle-orm';

import { accounts, goalAllocations, savingsGoals, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { today as todayDate } from '@/lib/dates';
import { Decimal, dec, toDecimalString, type DecimalString, type DecimalValue } from '@/lib/money';
import { accountBalances } from './balances';

export interface CurrencyPosition {
  currency: string;
  /** Sum of the balances of this currency's accounts that aren't archived. */
  balance: DecimalString;
  /** Money set aside in goals of this currency. */
  setAside: DecimalString;
  /** balance − setAside. May be negative (shown in red). */
  usable: DecimalString;
}

const zero = () => new Decimal(0);

/** Money set aside per goal per account (non-zero only). */
function allocations(db: AppDb): { goalId: string; accountId: string; amount: DecimalValue }[] {
  return db
    .select({ goalId: goalAllocations.goalId, accountId: goalAllocations.accountId, amount: goalAllocations.amount })
    .from(goalAllocations)
    .all()
    .reduce<{ goalId: string; accountId: string; amount: DecimalValue }[]>((out, r) => {
      const hit = out.find((o) => o.goalId === r.goalId && o.accountId === r.accountId);
      if (hit) hit.amount = hit.amount.plus(dec(r.amount));
      else out.push({ goalId: r.goalId, accountId: r.accountId, amount: dec(r.amount) });
      return out;
    }, [])
    .filter((a) => !a.amount.isZero());
}

/**
 * Usable is per currency only (Decided): the balance of that currency's
 * accounts minus what's set aside in goals of that currency. Archived accounts
 * don't count (archiving releases their set-aside money).
 */
export function currencyPositions(db: AppDb, asOf: string = todayDate()): Map<string, CurrencyPosition> {
  const balances = accountBalances(db, asOf);
  const active = db.select({ id: accounts.id, currency: accounts.currency }).from(accounts).where(isNull(accounts.archivedAt)).all();
  const goals = new Map(db.select({ id: savingsGoals.id, currency: savingsGoals.currency }).from(savingsGoals).all().map((g) => [g.id, g.currency]));

  const sums = new Map<string, { balance: DecimalValue; setAside: DecimalValue }>();
  const get = (c: string) => sums.get(c) ?? (sums.set(c, { balance: zero(), setAside: zero() }), sums.get(c)!);
  for (const a of active) get(a.currency).balance = get(a.currency).balance.plus(dec(balances.get(a.id) ?? '0'));
  for (const a of allocations(db)) {
    const currency = goals.get(a.goalId);
    if (currency) get(currency).setAside = get(currency).setAside.plus(a.amount);
  }

  const out = new Map<string, CurrencyPosition>();
  for (const [currency, s] of sums) {
    out.set(currency, {
      currency,
      balance: toDecimalString(s.balance),
      setAside: toDecimalString(s.setAside),
      usable: toDecimalString(s.balance.minus(s.setAside)),
    });
  }
  return out;
}

/** How much of one account is set aside (all goals), and what's free in it. */
export function accountFree(db: AppDb, accountId: string, asOf: string = todayDate()): { balance: DecimalString; setAside: DecimalString; free: DecimalString } {
  const balance = dec(accountBalances(db, asOf).get(accountId) ?? '0');
  const setAside = allocations(db)
    .filter((a) => a.accountId === accountId)
    .reduce((s, a) => s.plus(a.amount), zero());
  return { balance: toDecimalString(balance), setAside: toDecimalString(setAside), free: toDecimalString(balance.minus(setAside)) };
}

export type SpendWarning =
  | { level: 'none' }
  /** Amber: more than Usable in that currency, so it dips into savings. */
  | { level: 'savings'; usesSavings: DecimalString; usable: DecimalString; setAside: DecimalString; firstGoal: { name: string; amount: DecimalString } | null }
  /** Red: more than the account has. Shows by how much, and what set-aside money is used up. */
  | { level: 'balance'; overBy: DecimalString; after: DecimalString; setAsideUsedUp: DecimalString };

/**
 * The warning on Add transaction for money leaving an account (Spec §11 — a
 * warning only; saving is always allowed). Compares with today's balance and
 * Usable only; upcoming items are never subtracted.
 */
export function spendWarning(db: AppDb, accountId: string, amount: DecimalString, asOf: string = todayDate()): SpendWarning {
  const out = dec(amount);
  if (out.lte(0)) return { level: 'none' };
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) return { level: 'none' };

  const { balance, setAside } = accountFree(db, accountId, asOf);
  if (out.gt(dec(balance))) {
    return {
      level: 'balance',
      overBy: toDecimalString(out.minus(dec(balance))),
      after: toDecimalString(dec(balance).minus(out)),
      setAsideUsedUp: setAside,
    };
  }

  const position = currencyPositions(db, asOf).get(account.currency);
  if (!position || !out.gt(dec(position.usable))) return { level: 'none' };
  const usesSavings = Decimal.min(out.minus(Decimal.max(dec(position.usable), 0)), dec(position.setAside));

  // The lowest-priority goal holding money from this account gives up first.
  const priorities = new Map(db.select({ id: savingsGoals.id, name: savingsGoals.name, priority: savingsGoals.priority }).from(savingsGoals).all().map((g) => [g.id, g]));
  const held = allocations(db)
    .filter((a) => a.accountId === accountId && a.amount.gt(0) && priorities.has(a.goalId))
    .sort((x, y) => priorities.get(y.goalId)!.priority - priorities.get(x.goalId)!.priority)[0];
  const first = held ? { name: priorities.get(held.goalId)!.name, amount: toDecimalString(Decimal.min(held.amount, usesSavings)) } : null;

  return {
    level: 'savings',
    usesSavings: toDecimalString(usesSavings),
    usable: position.usable,
    setAside: position.setAside,
    firstGoal: first,
  };
}

/** "2 upcoming on this account · −₨18,500.00 by Oct 30": scheduled items moving this account. */
export function upcomingOnAccount(db: AppDb, accountId: string): { count: number; total: DecimalString; lastDate: string | null } {
  const rows = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.scheduled, true), isNull(transactions.deletedAt), ne(transactions.status, 'cancelled')))
    .all()
    .filter((t) => t.accountId === accountId || t.toAccountId === accountId);
  let total = zero();
  for (const t of rows) {
    if (t.accountId === accountId && t.accountAmount) {
      total = t.kind === 'income' || (t.kind === 'expense' && t.linkType) || t.kind === 'opening_balance' ? total.plus(dec(t.accountAmount)) : total.minus(dec(t.accountAmount));
    }
    if (t.toAccountId === accountId && t.toAmount) total = total.plus(dec(t.toAmount));
  }
  return {
    count: rows.length,
    total: toDecimalString(total),
    lastDate: rows.reduce<string | null>((d, t) => (d === null || t.date > d ? t.date : d), null),
  };
}
