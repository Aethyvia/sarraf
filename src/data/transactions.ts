import { and, eq, inArray } from 'drizzle-orm';

import { accounts, categories, people, personEntries, transactionCharges, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso, today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { dec, isCurrencyCode, isDecimalString, toDecimalString, type DecimalString } from '@/lib/money';
import { computeAmounts, type AmountResult, type RateMode } from './amounts';
import { applyAttachmentChanges, type AttachmentChanges } from './attachments';
import { DataError } from './errors';

export type TransactionRow = typeof transactions.$inferSelect;
export type TransactionStatus = TransactionRow['status'];

export const CHARGE_TYPES = [
  'transfer_fee',
  'platform_fee',
  'withdrawal_fee',
  'bank_charge',
  'service_charge',
  'card_fx_fee',
  'withholding_tax',
  'custom',
] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

/** Where a new charge of each type starts (Spec §11a): fees inside, taxes and bank charges on top. */
export const DEFAULT_DEDUCTION: Record<ChargeType, 'already_deducted' | 'charged_separately'> = {
  transfer_fee: 'already_deducted',
  platform_fee: 'already_deducted',
  withdrawal_fee: 'already_deducted',
  custom: 'already_deducted',
  bank_charge: 'charged_separately',
  withholding_tax: 'charged_separately',
  service_charge: 'charged_separately',
  card_fx_fee: 'charged_separately',
};

export interface ChargeDraft {
  type: ChargeType;
  /** Custom types only. */
  label?: string | null;
  amount: DecimalString;
  currency: string;
  deduction: 'already_deducted' | 'charged_separately';
  /** Inside charges in a third currency: into the main amount's currency. */
  rate?: DecimalString | null;
  rateMode?: RateMode | null;
  /** On-top charges only. */
  accountId?: string | null;
  isTax?: boolean;
}

/** What Add transaction saves. One side of each kind may be a person instead of an account. */
export interface TransactionDraft {
  kind: 'expense' | 'income' | 'transfer';
  date: string;
  status: Exclude<TransactionStatus, 'cancelled'>;
  expectedDate?: string | null;
  ledgerId?: string | null;
  categoryId?: string | null;
  /** TAG SOMEONE (NOTE ONLY). */
  referencePersonId?: string | null;
  /** Expense: paid from. Income: received into. Transfer: From. */
  accountId?: string | null;
  /** Expense "Paid from → Person", or a transfer From a person (borrowing / being paid back). */
  fromPersonId?: string | null;
  /** Transfer To one of your accounts. */
  toAccountId?: string | null;
  /** Transfer To a person (lending / paying back). */
  toPersonId?: string | null;
  amount: DecimalString;
  currency: string;
  rateMode?: RateMode;
  rate?: DecimalString | null;
  /** "I know what was charged / received". */
  knownAmount?: DecimalString | null;
  charges?: ChargeDraft[];
  reimbursable?: boolean;
  expectedFromPersonId?: string | null;
  notes?: string | null;
  recurringId?: string | null;
  recurringDueDate?: string | null;
  autoAdded?: boolean;
}

export const NOTES_MAX = 2000;

function requireRow<T>(row: T | undefined, what: string): T {
  if (!row) throw new DataError('not_found', `No ${what}`);
  return row;
}

function accountCurrency(db: AppDb, id: string): string {
  return requireRow(db.select({ c: accounts.currency }).from(accounts).where(eq(accounts.id, id)).get(), 'account').c;
}

function invalid(message: string): never {
  throw new DataError('invalid_amount', message);
}

/**
 * Works out a draft's stored amounts and checks it, without saving.
 * Throws DataError (or AmountError) when something needed is missing.
 */
export function prepareTransaction(db: AppDb, draft: TransactionDraft): AmountResult & { currency: string } {
  if (!isDecimalString(draft.amount) || dec(draft.amount).lte(0)) invalid('Enter an amount above zero');
  if (!isCurrencyCode(draft.currency)) throw new DataError('invalid_currency', `Unknown currency ${draft.currency}`);
  if (draft.notes && draft.notes.length > NOTES_MAX) invalid('Notes are too long');

  const fromAccount = draft.accountId ? accountCurrency(db, draft.accountId) : null;
  const toAccount = draft.toAccountId ? accountCurrency(db, draft.toAccountId) : null;
  for (const id of [draft.fromPersonId, draft.toPersonId, draft.referencePersonId, draft.expectedFromPersonId]) {
    if (id) requireRow(db.select({ id: people.id }).from(people).where(eq(people.id, id)).get(), 'person');
  }

  if (draft.categoryId) {
    const category = requireRow(db.select().from(categories).where(eq(categories.id, draft.categoryId)).get(), 'category');
    if (draft.kind === 'transfer' || category.kind !== draft.kind) {
      throw new DataError('category_kind_mismatch', 'That category is for the other kind');
    }
  }

  const charges = draft.charges ?? [];
  for (const c of charges) {
    if (!isDecimalString(c.amount) || dec(c.amount).lte(0)) invalid('A charge needs an amount above zero');
    if (c.deduction === 'charged_separately') {
      if (!c.accountId) invalid('An on-top charge needs an account');
      if (accountCurrency(db, c.accountId) !== c.currency) invalid('An on-top charge is in its account’s currency');
    }
  }

  let currency = draft.currency;
  let receivingCurrency: string;
  let receivingAccountId: string | null = null;

  switch (draft.kind) {
    case 'expense':
      if (!!draft.accountId === !!draft.fromPersonId) invalid('Pick where it was paid from');
      receivingCurrency = fromAccount ?? draft.currency;
      break;
    case 'income':
      if (!draft.accountId) invalid('Pick the account it went into');
      receivingCurrency = fromAccount!;
      receivingAccountId = draft.accountId!;
      break;
    case 'transfer': {
      const from = (draft.accountId ? 1 : 0) + (draft.fromPersonId ? 1 : 0);
      const to = (draft.toAccountId ? 1 : 0) + (draft.toPersonId ? 1 : 0);
      if (from !== 1 || to !== 1) invalid('Pick From and To');
      if (draft.fromPersonId && draft.toPersonId) invalid('One side of a transfer is your account');
      if (draft.accountId && draft.accountId === draft.toAccountId) invalid('From and To are the same account');
      if (draft.accountId) {
        // What left From is in From's currency.
        currency = fromAccount!;
        receivingCurrency = toAccount ?? fromAccount!;
      } else {
        // From a person into your account: in that account's currency, no conversion.
        currency = toAccount!;
        receivingCurrency = toAccount!;
      }
      receivingAccountId = draft.toAccountId ?? null;
      break;
    }
  }

  const amounts = computeAmounts({
    kind: draft.kind,
    amount: draft.amount,
    currency,
    receivingCurrency,
    receivingAccountId,
    rateMode: draft.rateMode ?? 'rate_known',
    rate: draft.rate ?? null,
    knownAmount: draft.knownAmount ?? null,
    charges,
  });
  return { ...amounts, currency };
}

/**
 * Saves a new transaction, or replaces an existing one (`id`), with its charges
 * and the person entries it causes. Returns the id.
 * - A date after today makes it Upcoming (scheduled): it waits in Needs review
 *   and counts nowhere until confirmed.
 * - Cross-currency rows keep the market rate at entry, when one is known.
 * - Attachment rows are added and removed in the same save; the caller removes
 *   the files of removed ones afterwards.
 */
export function saveTransaction(
  db: AppDb,
  draft: TransactionDraft,
  options: {
    id?: string;
    today?: string;
    marketRate?: { rate: DecimalString; fetchedAt: string } | null;
    attachments?: AttachmentChanges;
  } = {},
): { id: string; removedAttachmentPaths: string[] } {
  const today = options.today ?? todayDate();
  const id = options.id ?? newId();

  return db.transaction((tx) => {
    const existing = options.id ? requireRow(tx.select().from(transactions).where(eq(transactions.id, options.id)).get(), 'transaction') : null;
    const a = prepareTransaction(tx, draft);
    const isPersonTransfer = draft.kind === 'transfer' && (draft.fromPersonId || draft.toPersonId);

    const row: typeof transactions.$inferInsert = {
      id,
      kind: draft.kind,
      date: draft.date,
      expectedDate: draft.status === 'pending' ? (draft.expectedDate ?? null) : null,
      scheduled: draft.date > today,
      status: draft.status,
      ledgerId: draft.ledgerId ?? null,
      categoryId: draft.kind === 'transfer' ? null : (draft.categoryId ?? null),
      referencePersonId: draft.referencePersonId ?? null,
      accountId: draft.accountId ?? null,
      amount: toDecimalString(dec(draft.amount)),
      currency: a.currency,
      rate: a.rate,
      rateMode: a.converts ? (draft.rateMode ?? 'rate_known') : null,
      accountAmount: draft.accountId ? a.accountAmount : null,
      toAccountId: draft.kind === 'transfer' ? (draft.toAccountId ?? null) : null,
      toAmount: draft.kind === 'transfer' && draft.toAccountId ? a.toAmount : null,
      transferPersonId: isPersonTransfer ? (draft.fromPersonId ?? draft.toPersonId ?? null) : null,
      paidByPersonId: draft.kind === 'expense' ? (draft.fromPersonId ?? null) : null,
      netAmount: a.netAmount,
      reimbursable: draft.kind === 'expense' ? !!draft.reimbursable : false,
      expectedFromPersonId: draft.kind === 'expense' && draft.reimbursable ? (draft.expectedFromPersonId ?? null) : null,
      reimbursementStatus: draft.kind === 'expense' && draft.reimbursable ? (existing?.reimbursementStatus ?? 'awaiting') : null,
      recurringId: draft.recurringId ?? existing?.recurringId ?? null,
      recurringDueDate: draft.recurringDueDate ?? existing?.recurringDueDate ?? null,
      autoAdded: draft.autoAdded ?? existing?.autoAdded ?? false,
      notes: draft.notes?.trim() || null,
      marketRateAtEntry: a.converts ? (options.marketRate?.rate ?? existing?.marketRateAtEntry ?? null) : null,
      marketRateFetchedAt: a.converts ? (options.marketRate?.fetchedAt ?? existing?.marketRateFetchedAt ?? null) : null,
      updatedAt: nowIso(),
    };

    if (existing) {
      tx.update(transactions).set(row).where(eq(transactions.id, id)).run();
      tx.delete(transactionCharges).where(eq(transactionCharges.transactionId, id)).run();
      tx.delete(personEntries)
        .where(and(eq(personEntries.transactionId, id), inArray(personEntries.source, ['transfer', 'paid_by_person'])))
        .run();
    } else {
      tx.insert(transactions).values(row).run();
    }

    for (const c of draft.charges ?? []) {
      tx.insert(transactionCharges)
        .values({
          id: newId(),
          transactionId: id,
          type: c.type,
          label: c.type === 'custom' ? (c.label?.trim() || null) : null,
          amount: toDecimalString(dec(c.amount)),
          currency: c.currency,
          rate: c.deduction === 'already_deducted' ? (c.rate ?? null) : null,
          rateMode: c.deduction === 'already_deducted' && c.rate ? (c.rateMode ?? 'rate_known') : null,
          deduction: c.deduction,
          accountId: c.deduction === 'charged_separately' ? c.accountId! : null,
          // Withholding tax is always tax.
          isTax: c.type === 'withholding_tax' || !!c.isTax,
        })
        .run();
    }

    // What a person owes changes only through a transfer with them or an expense they paid.
    const entry = (personId: string, amount: DecimalString, source: 'transfer' | 'paid_by_person') =>
      tx.insert(personEntries)
        .values({ id: newId(), personId, transactionId: id, source, currency: a.currency, amount, date: draft.date })
        .run();
    const amount = toDecimalString(dec(draft.amount));
    if (draft.kind === 'transfer' && draft.toPersonId) entry(draft.toPersonId, amount, 'transfer');
    if (draft.kind === 'transfer' && draft.fromPersonId) entry(draft.fromPersonId, toDecimalString(dec(amount).negated()), 'transfer');
    if (draft.kind === 'expense' && draft.fromPersonId) entry(draft.fromPersonId, toDecimalString(dec(amount).negated()), 'paid_by_person');

    const { removedPaths } = applyAttachmentChanges(tx, { transactionId: id }, options.attachments);
    return { id, removedAttachmentPaths: removedPaths };
  });
}

/** Loads a saved transaction back into a draft, for Edit and "Edit and add transaction". */
export function draftFromTransaction(db: AppDb, id: string): TransactionDraft {
  const t = requireRow(db.select().from(transactions).where(eq(transactions.id, id)).get(), 'transaction');
  if (t.kind !== 'expense' && t.kind !== 'income' && t.kind !== 'transfer') throw new DataError('not_found', 'Not an editable transaction');
  const charges = db.select().from(transactionCharges).where(eq(transactionCharges.transactionId, id)).all();
  const toPerson = t.kind === 'transfer' && t.transferPersonId && t.accountId ? t.transferPersonId : null;
  const fromPerson = t.paidByPersonId ?? (t.kind === 'transfer' && t.transferPersonId && !t.accountId ? t.transferPersonId : null);
  return {
    kind: t.kind,
    date: t.date,
    status: t.status === 'cancelled' ? 'cleared' : t.status,
    expectedDate: t.expectedDate,
    ledgerId: t.ledgerId,
    categoryId: t.categoryId,
    referencePersonId: t.referencePersonId,
    accountId: t.accountId,
    fromPersonId: fromPerson,
    toAccountId: t.toAccountId,
    toPersonId: toPerson,
    amount: t.amount,
    currency: t.currency,
    rateMode: t.rateMode ?? 'rate_known',
    rate: t.rateMode === 'amount_known' ? null : t.rate,
    knownAmount: t.rateMode === 'amount_known' ? (t.kind === 'transfer' ? t.toAmount : t.accountAmount) : null,
    charges: charges.map((c) => ({
      type: c.type,
      label: c.label,
      amount: c.amount,
      currency: c.currency,
      deduction: c.deduction,
      rate: c.rate,
      rateMode: c.rateMode,
      accountId: c.accountId,
      isTax: c.isTax,
    })),
    reimbursable: t.reimbursable,
    expectedFromPersonId: t.expectedFromPersonId,
    notes: t.notes,
    recurringId: t.recurringId,
    recurringDueDate: t.recurringDueDate,
    autoAdded: t.autoAdded,
  };
}
