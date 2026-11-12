import { and, asc, desc, isNull } from 'drizzle-orm';

import { accounts, ledgers, savingsGoals } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { archiveAccount } from './accounts';
import { DataError } from './errors';
import { archiveGoal } from './goals';
import { archiveLedger } from './ledgers';
import { FREE_LIMITS, usage, type LimitedKind, type Plan } from './limits';

/**
 * When Sarraf Plus ends (Owner, Nov 12 — replaces "nothing is ever locked"):
 * after the 7-day grace, someone over the free limits is asked to renew or to
 * choose what stays active. What they don't keep is archived, and archive
 * rules apply (out of totals and Usable, history kept, nothing deleted).
 * Closing the question archives nothing; it's asked again on the next open.
 */
export type Keep = Record<LimitedKind, string[]>;

/** How many of each are over the free limit right now (0 when on Plus). */
export function overLimit(db: AppDb, plan: Plan): Record<LimitedKind, number> {
  const over = (k: LimitedKind) => (plan === 'plus' ? 0 : Math.max(0, usage(db, k) - FREE_LIMITS[k]));
  return { accounts: over('accounts'), ledgers: over('ledgers'), goals: over('goals') };
}

export function needsPlanChoice(db: AppDb, plan: Plan): boolean {
  const o = overLimit(db, plan);
  return o.accounts + o.ledgers + o.goals > 0;
}

/** What counts toward each limit, in the order the app shows them; the default ledger first. */
export function activeItems(db: AppDb) {
  return {
    accounts: db.select().from(accounts).where(isNull(accounts.archivedAt)).orderBy(asc(accounts.rank)).all(),
    ledgers: db.select().from(ledgers).where(isNull(ledgers.archivedAt)).orderBy(desc(ledgers.isDefault), asc(ledgers.createdAt)).all(),
    goals: db
      .select()
      .from(savingsGoals)
      .where(and(isNull(savingsGoals.archivedAt), isNull(savingsGoals.completedAt)))
      .orderBy(asc(savingsGoals.priority))
      .all(),
  };
}

/** A starting choice: the first ones in each list (the user changes it before confirming). */
export function suggestedKeep(db: AppDb): Keep {
  const a = activeItems(db);
  return {
    accounts: a.accounts.slice(0, FREE_LIMITS.accounts).map((x) => x.id),
    ledgers: a.ledgers.slice(0, FREE_LIMITS.ledgers).map((x) => x.id),
    goals: a.goals.slice(0, FREE_LIMITS.goals).map((x) => x.id),
  };
}

/**
 * Keeps the chosen ones active and archives every other active one. At most the
 * free limit of each may be kept; the default ledger must be kept. One
 * transaction: all or nothing.
 */
export function applyPlanChoice(db: AppDb, keep: Keep): { archived: Record<LimitedKind, number> } {
  for (const k of ['accounts', 'ledgers', 'goals'] as const) {
    if (new Set(keep[k]).size > FREE_LIMITS[k]) throw new DataError('limit_reached', `Keep at most ${FREE_LIMITS[k]} ${k}`);
  }
  return db.transaction((tx) => {
    const a = activeItems(tx);
    const defaultLedger = a.ledgers.find((l) => l.isDefault);
    if (defaultLedger && !keep.ledgers.includes(defaultLedger.id)) throw new DataError('default_ledger', 'Keep your default ledger');
    const drop = <T extends { id: string }>(list: T[], kept: string[]) => list.filter((x) => !kept.includes(x.id));
    const archived = {
      accounts: drop(a.accounts, keep.accounts),
      ledgers: drop(a.ledgers, keep.ledgers),
      goals: drop(a.goals, keep.goals),
    };
    for (const x of archived.accounts) archiveAccount(tx, x.id);
    for (const x of archived.ledgers) archiveLedger(tx, x.id);
    for (const x of archived.goals) archiveGoal(tx, x.id);
    return { archived: { accounts: archived.accounts.length, ledgers: archived.ledgers.length, goals: archived.goals.length } };
  });
}

