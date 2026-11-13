import { and, desc, eq, isNull, lte, ne } from 'drizzle-orm';

import { accounts, categories, people, transactionCharges, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { today as todayDate } from '@/lib/dates';
import { dec, toDecimalString, type DecimalString } from '@/lib/money';
import type { TransactionRow } from './transactions';

export type ListKind = 'expense' | 'income' | 'transfer';

/** Transactions filters (Spec §9 — Decided): each can take several values; no filter = all. */
export interface TransactionFilters {
  ledgerIds?: string[];
  kinds?: ListKind[];
  accountIds?: string[];
  /** A category includes its subcategories. */
  categoryIds?: string[];
  currencies?: string[];
  from?: string | null;
  to?: string | null;
  /** The Reimbursable filter (replaces the old Reimbursements screen). */
  reimbursable?: boolean;
}

export type ListTag = 'reimbursable' | 'reimbursed' | 'in_transit' | 'pending' | 'paid_by' | 'auto_review' | 'auto';

/** One row of the Transactions list, as data; the screen turns it into words. */
export interface ListRow {
  id: string;
  date: string;
  kind: TransactionRow['kind'];
  /** Category, the tagged person (income), notes, or "From → To" for a transfer. */
  title: string | null;
  /** The account (or "From → To" for a person transfer). */
  accountName: string | null;
  categoryName: string | null;
  /** The row's icon: its category's, or one for transfers, money back and adjustments. */
  icon: { name: string; color: string };
  amount: { value: DecimalString; currency: string; tone: 'expense' | 'income' | 'neutral' };
  /** Transfers between currencies: what was sent, under what arrived. */
  sent: { value: DecimalString; currency: string } | null;
  tags: ListTag[];
  paidByName: string | null;
  cancelled: boolean;
  /** Linked refunds / reimbursements shown under this row. */
  children: ListRow[];
  /** Set on a linked row repeated greyed on its own date: the original it belongs to. */
  echoOf: { id: string; title: string | null; date: string } | null;
  linkType: 'refund' | 'reimbursement' | null;
}

export interface ListGroup {
  date: string;
  rows: ListRow[];
}

interface Lookups {
  accounts: Map<string, { name: string; currency: string }>;
  categories: Map<string, { name: string; parentId: string | null; icon: string; color: string }>;
  people: Map<string, string>;
  /** On-top charges by transaction: they leave their own account along with the main amount. */
  onTop: Map<string, { accountId: string; amount: string }[]>;
}

function lookups(db: AppDb): Lookups {
  const onTop = new Map<string, { accountId: string; amount: string }[]>();
  for (const c of db
    .select({ tx: transactionCharges.transactionId, accountId: transactionCharges.accountId, amount: transactionCharges.amount })
    .from(transactionCharges)
    .where(eq(transactionCharges.deduction, 'charged_separately'))
    .all()) {
    if (c.accountId) onTop.set(c.tx, [...(onTop.get(c.tx) ?? []), { accountId: c.accountId, amount: c.amount }]);
  }
  return {
    onTop,
    accounts: new Map(db.select({ id: accounts.id, name: accounts.name, currency: accounts.currency }).from(accounts).all().map((a) => [a.id, a])),
    categories: new Map(
      db.select({ id: categories.id, name: categories.name, parentId: categories.parentId, icon: categories.icon, color: categories.color }).from(categories).all().map((c) => [c.id, c]),
    ),
    people: new Map(db.select({ id: people.id, name: people.name }).from(people).all().map((p) => [p.id, p.name])),
  };
}

const firstLine = (s: string | null) => s?.split('\n')[0]?.trim() || null;

/** What left the transaction's own account: its amount plus on-top charges paid from that same account. */
export function totalOut(t: Pick<TransactionRow, 'id' | 'accountId' | 'amount' | 'accountAmount'>, l: Pick<Lookups, 'onTop'>): DecimalString {
  const base = dec(t.accountAmount ?? t.amount);
  const extra = (l.onTop.get(t.id) ?? []).filter((c) => c.accountId === t.accountId).reduce((s, c) => s.plus(dec(c.amount)), dec('0'));
  return toDecimalString(base.plus(extra));
}

/** What landed in an account, less on-top charges taken from that same account. */
function wentUp(txId: string, accountId: string | null, arrived: DecimalString, l: Pick<Lookups, 'onTop'>): DecimalString {
  const extra = (l.onTop.get(txId) ?? []).filter((c) => c.accountId === accountId).reduce((s, c) => s.plus(dec(c.amount)), dec('0'));
  return toDecimalString(dec(arrived).minus(extra));
}

/** A row's display data. */
export function toListRow(t: TransactionRow, l: Lookups): ListRow {
  const account = t.accountId ? l.accounts.get(t.accountId) : undefined;
  const to = t.toAccountId ? l.accounts.get(t.toAccountId) : undefined;
  const person = t.transferPersonId ? l.people.get(t.transferPersonId) : undefined;
  const categoryRow = t.categoryId ? l.categories.get(t.categoryId) : undefined;
  const category = categoryRow?.name ?? null;
  const tagged = t.referencePersonId ? (l.people.get(t.referencePersonId) ?? null) : null;

  let title: string | null;
  let accountName: string | null = account?.name ?? null;
  let amount: ListRow['amount'];
  let sent: ListRow['sent'] = null;

  switch (t.kind) {
    case 'income':
      title = tagged ?? category ?? firstLine(t.notes);
      // What the account went up by: what arrived, less charges taken there separately (owner, Nov 13).
      amount = { value: wentUp(t.id, t.accountId, t.accountAmount ?? t.amount, l), currency: account?.currency ?? t.currency, tone: 'income' };
      break;
    case 'expense':
      // The boards name an expense by its note ("Netflix", "Client travel expense"), else its category.
      title = firstLine(t.notes) ?? category;
      if (t.linkType) {
        title = firstLine(t.notes);
        amount = { value: t.accountAmount ?? t.amount, currency: account?.currency ?? t.currency, tone: 'income' };
      } else if (t.accountId) {
        // The total that left the account: the price plus on-top charges from the same account (owner, Nov 13).
        amount = { value: totalOut(t, l), currency: account?.currency ?? t.currency, tone: 'expense' };
      } else {
        amount = { value: t.amount, currency: t.currency, tone: 'expense' };
      }
      break;
    case 'transfer': {
      const fromName = account?.name ?? person ?? '';
      const toName = to?.name ?? person ?? '';
      title = firstLine(t.notes) ?? `${fromName} → ${toName}`;
      accountName = `${fromName} → ${toName}`;
      if (to && t.toAmount && account && to.currency !== account.currency) {
        amount = { value: wentUp(t.id, t.toAccountId, t.toAmount, l), currency: to.currency, tone: 'neutral' };
        sent = { value: t.accountAmount ?? t.amount, currency: account.currency };
      } else {
        amount = { value: t.toAmount ?? t.accountAmount ?? t.amount, currency: to?.currency ?? account?.currency ?? t.currency, tone: 'neutral' };
      }
      break;
    }
    default:
      // Opening balance and balance adjustment: neutral, signed.
      title = null;
      amount = { value: t.accountAmount ?? t.amount, currency: account?.currency ?? t.currency, tone: 'neutral' };
  }

  const tags: ListTag[] = [];
  if (t.autoAdded) tags.push(t.status === 'pending' || t.status === 'in_transit' ? 'auto_review' : 'auto');
  else if (t.status === 'in_transit') tags.push('in_transit');
  else if (t.status === 'pending') tags.push('pending');
  if (t.reimbursable) tags.push(t.reimbursementStatus === 'reimbursed' ? 'reimbursed' : 'reimbursable');
  if (t.paidByPersonId) tags.push('paid_by');

  // The boards: income and transfers get an incoming arrow, anything with a person a person,
  // linked money back a tick; expenses show their category.
  const icon =
    t.linkType
      ? { name: 'tick', color: 'teal' }
      : t.kind === 'transfer'
        ? person
          ? { name: 'user', color: 'neutral' }
          : { name: 'arrow-in', color: 'teal' }
        : t.kind === 'income'
          ? { name: 'arrow-in', color: 'teal' }
          : t.kind === 'opening_balance' || t.kind === 'balance_adjustment'
            ? { name: 'accounts', color: 'neutral' }
            : t.paidByPersonId
              ? { name: 'user', color: 'neutral' }
              : categoryRow
                ? { name: categoryRow.icon, color: categoryRow.color }
                : { name: 'circle', color: 'neutral' };

  return {
    id: t.id,
    date: t.date,
    kind: t.kind,
    title,
    accountName,
    categoryName: category,
    icon,
    amount,
    sent,
    tags,
    paidByName: t.paidByPersonId ? (l.people.get(t.paidByPersonId) ?? null) : null,
    cancelled: t.status === 'cancelled',
    children: [],
    echoOf: null,
    linkType: t.linkType,
  };
}

/** One row's display data, looking names up (for a single transaction). */
export function toListRowFromDb(db: AppDb, t: TransactionRow): ListRow {
  return toListRow(t, lookups(db));
}

/** The currencies a row moves, for the Currency filter. */
function rowCurrencies(t: TransactionRow, l: Lookups): string[] {
  const out = new Set<string>();
  if (t.accountId) out.add(l.accounts.get(t.accountId)?.currency ?? t.currency);
  else out.add(t.currency);
  if (t.toAccountId) out.add(l.accounts.get(t.toAccountId)?.currency ?? t.currency);
  return [...out];
}

/**
 * The Transactions list (Spec §9): today and earlier only (Upcoming waits in
 * Needs review), newest first, grouped by day. Linked refunds and
 * reimbursements sit under their original and are repeated, greyed, on the
 * day the money moved.
 */
export function listTransactions(db: AppDb, filters: TransactionFilters = {}, today: string = todayDate()): ListGroup[] {
  const l = lookups(db);
  const rows = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.scheduled, false), lte(transactions.date, today)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .all();

  // Category filter includes subcategories.
  const categorySet = filters.categoryIds?.length
    ? new Set([...filters.categoryIds, ...[...l.categories].filter(([, c]) => c.parentId && filters.categoryIds!.includes(c.parentId)).map(([id]) => id)])
    : null;
  const chargeAccounts = filters.accountIds?.length
    ? new Map<string, Set<string>>(
        db
          .select({ t: transactionCharges.transactionId, a: transactionCharges.accountId })
          .from(transactionCharges)
          .where(ne(transactionCharges.deduction, 'already_deducted'))
          .all()
          .reduce((m, r) => (r.a ? m.set(r.t, (m.get(r.t) ?? new Set()).add(r.a)) : m), new Map<string, Set<string>>()),
      )
    : null;

  const matches = (t: TransactionRow) => {
    if (filters.ledgerIds?.length && (!t.ledgerId || !filters.ledgerIds.includes(t.ledgerId))) return false;
    if (filters.kinds?.length && !filters.kinds.includes(t.kind as ListKind)) return false;
    if (filters.accountIds?.length) {
      const ids = filters.accountIds;
      const hit = (t.accountId && ids.includes(t.accountId)) || (t.toAccountId && ids.includes(t.toAccountId)) || [...(chargeAccounts?.get(t.id) ?? [])].some((a) => ids.includes(a));
      if (!hit) return false;
    }
    if (categorySet && (!t.categoryId || !categorySet.has(t.categoryId))) return false;
    if (filters.currencies?.length && !rowCurrencies(t, l).some((c) => filters.currencies!.includes(c))) return false;
    if (filters.from && t.date < filters.from) return false;
    if (filters.to && t.date > filters.to) return false;
    if (filters.reimbursable && !t.reimbursable) return false;
    return true;
  };

  const byId = new Map(rows.map((t) => [t.id, t]));
  const childrenOf = new Map<string, TransactionRow[]>();
  for (const t of rows) if (t.parentId) childrenOf.set(t.parentId, [...(childrenOf.get(t.parentId) ?? []), t]);

  const groups = new Map<string, ListRow[]>();
  const push = (date: string, row: ListRow) => groups.set(date, [...(groups.get(date) ?? []), row]);

  for (const t of rows) {
    if (t.parentId && byId.has(t.parentId)) continue; // shown under its original
    if (!matches(t)) continue;
    const row = toListRow(t, l);
    row.children = (childrenOf.get(t.id) ?? []).map((c) => toListRow(c, l));
    push(t.date, row);
    for (const c of childrenOf.get(t.id) ?? []) {
      if (c.date === t.date) continue;
      if ((filters.from && c.date < filters.from) || (filters.to && c.date > filters.to)) continue;
      push(c.date, { ...toListRow(c, l), echoOf: { id: t.id, title: row.title, date: t.date } });
    }
  }

  return [...groups].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0)).map(([date, list]) => ({ date, rows: list }));
}

/** Home's Recent: the last N rows of the Transactions list (no echoes). */
export function recentTransactions(db: AppDb, n = 6, today: string = todayDate()): ListRow[] {
  const out: ListRow[] = [];
  for (const g of listTransactions(db, {}, today)) {
    for (const r of g.rows) {
      if (r.echoOf || r.kind === 'opening_balance' || r.kind === 'balance_adjustment') continue;
      out.push(r);
      if (out.length === n) return out;
    }
  }
  return out;
}

