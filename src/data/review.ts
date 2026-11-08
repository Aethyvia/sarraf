import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';

import { transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso, today as todayDate } from '@/lib/dates';
import { DataError } from './errors';
import { shrinkGoalsToFit } from './goals';
import { remindersDue, type RecurringItem } from './recurring';
import { withLinkedChildren } from './transaction-sets';
import type { TransactionRow } from './transactions';

/**
 * Needs review (Spec §10, §9d — Decided): where Pending, In transit, auto-added
 * and Upcoming items wait, plus reimbursables waiting for money back.
 */
export interface NeedsReview {
  /** Added automatically by a recurring item; confirmed with Paid (expenses) or Received. */
  recurring: TransactionRow[];
  /** "Remind me, don't auto-add" items whose date has come; Paid / Received adds them. */
  reminders: RecurringItem[];
  pending: TransactionRow[];
  inTransit: TransactionRow[];
  /** Reimbursable expenses awaiting money back. Not in the badge. */
  waitingBack: TransactionRow[];
  /** Future-dated (scheduled). Each gets its button once its date arrives. */
  upcoming: TransactionRow[];
  /** Home's badge: items that need confirming now (not upcoming ones still in the future, not reimbursables). */
  toConfirm: number;
  upcomingCount: number;
}

export function needsReview(db: AppDb, today: string = todayDate()): NeedsReview {
  const live = and(isNull(transactions.deletedAt), ne(transactions.status, 'cancelled'));
  const open = db
    .select()
    .from(transactions)
    .where(and(live, or(inArray(transactions.status, ['pending', 'in_transit']), eq(transactions.scheduled, true))))
    .orderBy(transactions.date)
    .all();
  const waitingBack = db
    .select()
    .from(transactions)
    .where(and(live, eq(transactions.reimbursable, true), inArray(transactions.reimbursementStatus, ['awaiting', 'partly_back'])))
    .orderBy(transactions.date)
    .all();

  const upcoming = open.filter((t) => t.scheduled);
  const now = open.filter((t) => !t.scheduled);
  const recurring = now.filter((t) => t.autoAdded);
  const pending = now.filter((t) => !t.autoAdded && t.status === 'pending');
  const inTransit = now.filter((t) => !t.autoAdded && t.status === 'in_transit');
  const dueUpcoming = upcoming.filter((t) => t.date <= today).length;

  const reminders = remindersDue(db, today);
  return {
    recurring,
    reminders,
    pending,
    inTransit,
    waitingBack,
    upcoming,
    toConfirm: recurring.length + reminders.length + pending.length + inTransit.length + dueUpcoming,
    upcomingCount: upcoming.length - dueUpcoming,
  };
}

/**
 * Which button an item gets (Decided Nov 7): Paid for recurring expenses,
 * Received for everything else — pending items, transfers in transit,
 * recurring income and transfers. An Upcoming expense gets Paid on its date (§9d).
 */
export function confirmLabel(t: Pick<TransactionRow, 'kind' | 'recurringId' | 'autoAdded' | 'scheduled'>): 'paid' | 'received' {
  return t.kind === 'expense' && (t.recurringId || t.autoAdded || t.scheduled) ? 'paid' : 'received';
}

function getRow(db: AppDb, id: string): TransactionRow {
  const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!row || row.deletedAt) throw new DataError('not_found', `No transaction ${id}`);
  return row;
}

/** True when confirming needs more from the user first (a transfer whose received amount isn't known yet). */
export function needsDetailsToConfirm(t: TransactionRow): boolean {
  return t.kind === 'transfer' && !!t.toAccountId && t.toAmount === null;
}

/**
 * Paid / Received: the item becomes Cleared on the chosen date (default today,
 * or the original date), stops being Upcoming, and starts counting.
 * An Upcoming item can only be confirmed once its date has arrived.
 */
export function confirmTransaction(db: AppDb, id: string, date: string, today: string = todayDate()): void {
  db.transaction((tx) => {
    const t = getRow(tx, id);
    if (t.status === 'cancelled') throw new DataError('invalid_target', 'A cancelled item can’t be confirmed');
    if (t.scheduled && t.date > today) throw new DataError('invalid_target', 'It isn’t due yet');
    if (needsDetailsToConfirm(t)) throw new DataError('invalid_amount', 'Enter what arrived first');
    if (date > today) throw new DataError('invalid_target', 'Pick today or an earlier date');
    tx.update(transactions)
      .set({ status: 'cleared', scheduled: false, date, expectedDate: null, updatedAt: nowIso() })
      .where(eq(transactions.id, id))
      .run();
    // Now that it counts, it may eat into money set aside.
    if (t.accountId) shrinkGoalsToFit(tx, t.accountId, today);
  });
}

/** A Pending item can be moved to In transit (the money has left but not arrived). */
export function markInTransit(db: AppDb, id: string): void {
  db.transaction((tx) => {
    const t = getRow(tx, id);
    if (t.status !== 'pending') throw new DataError('invalid_target', 'Only a Pending item can go In transit');
    tx.update(transactions).set({ status: 'in_transit', expectedDate: null, updatedAt: nowIso() }).where(eq(transactions.id, id)).run();
  });
}

/**
 * Cancelled: it didn't happen. Kept in history (struck through) and left out of
 * balances, budgets and reports. Linked refunds and reimbursements are cancelled with it.
 */
export function cancelTransaction(db: AppDb, id: string): void {
  db.transaction((tx) => {
    getRow(tx, id);
    const ids = withLinkedChildren(tx, [id]);
    tx.update(transactions).set({ status: 'cancelled', scheduled: false, updatedAt: nowIso() }).where(inArray(transactions.id, ids)).run();
  });
}
