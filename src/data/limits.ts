import { count, isNull } from 'drizzle-orm';

import { accounts, ledgers, savingsGoals } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { DataError } from './errors';

export type Plan = 'free' | 'plus';

/** Free plan (Decided Nov 7). Budgets are unlimited. Backup and export are always free. */
export const FREE_LIMITS = { accounts: 5, ledgers: 2, goals: 3 } as const;
export type LimitedKind = keyof typeof FREE_LIMITS;

export class LimitReachedError extends DataError {
  constructor(
    readonly kind: LimitedKind,
    readonly limit: number,
    readonly used: number,
  ) {
    super('limit_reached', `Free plan allows ${limit} ${kind}; ${used} in use`);
  }
}

/** How many count toward the limit. Archived rows don't count. */
export function usage(db: AppDb, kind: LimitedKind): number {
  const table = { accounts, ledgers, goals: savingsGoals }[kind];
  const row = db.select({ n: count() }).from(table).where(isNull(table.archivedAt)).get();
  return row?.n ?? 0;
}

/**
 * Checked only when creating something (or unarchiving, which counts as adding one back).
 * Nothing over a limit is ever deleted, hidden or made read-only.
 */
export function assertCanAdd(db: AppDb, kind: LimitedKind, plan: Plan): void {
  if (plan === 'plus') return;
  const used = usage(db, kind);
  if (used >= FREE_LIMITS[kind]) throw new LimitReachedError(kind, FREE_LIMITS[kind], used);
}
