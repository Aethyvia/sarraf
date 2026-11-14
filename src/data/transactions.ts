import { and, eq, inArray } from 'drizzle-orm';

import { accounts, categories, people, personEntries, splitShares, transactionCharges, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso, today as todayDate } from '@/lib/dates';
import { newId } from '@/lib/id';
import { dec, isCurrencyCode, isDecimalString, toDecimalString, type DecimalString } from '@/lib/money';
import { amountFromArrived, computeAmounts, type AmountResult, type RateMode } from './amounts';
import { applyAttachmentChanges, type AttachmentChanges } from './attachments';
import { DataError } from './errors';
import { shrinkGoalsToFit } from './goals';
import { noteRecurringHandled } from './recurring-schedule';
import { checkSplit, splitOf, type SplitDraft } from './splits';

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
  /** Form only, never saved: an earlier change means this charge needs a look ("Check this charge"). */
  check?: boolean;
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
  /** "I know what was charged / received". With enteredAs 'arrived': what arrived. */
  knownAmount?: DecimalString | null;
  /**
   * "What arrived" (owner, Nov 15): income, or a transfer between your accounts, typed as what
   * arrived (knownAmount) instead of the amount before fees. `amount` is then worked out from the
   * included charges (and `rate`, across currencies); whatever `amount` holds is ignored.
   */
  enteredAs?: 'sent' | 'arrived';
  charges?: ChargeDraft[];
  reimbursable?: boolean;
  expectedFromPersonId?: string | null;
  notes?: string | null;
  recurringId?: string | null;
  recurringDueDate?: string | null;
  autoAdded?: boolean;
  /** Expense only: split with people (Spec §9c). With fromPersonId set, someone else paid. */
  split?: SplitDraft | null;
  /**
   * A transfer with a person paid in another currency (Decided Nov 12): their
   * balance moves by personAmount in personCurrency, not by the transfer's amount.
   */
  personCurrency?: string | null;
  personAmount?: DecimalString | null;
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
export function prepareTransaction(db: AppDb, draft: TransactionDraft): AmountResult & { currency: string; amount: DecimalString } {
  if (draft.enteredAs === 'arrived') return prepareArrived(db, draft);
  // 0 is allowed for a charge on its own: only separate charges, e.g. a bank fee that posts later (owner, Nov 14).
  const chargeOnly = (draft.charges ?? []).some((c) => c.deduction === 'charged_separately');
  if (!isDecimalString(draft.amount) || dec(draft.amount).isNegative() || (dec(draft.amount).isZero() && !chargeOnly)) {
    invalid('Enter an amount above zero');
  }
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
  return { ...amounts, currency, amount: toDecimalString(dec(draft.amount)) };
}

/** Whether "Sent | Arrived" applies: money coming into one of your accounts (income, or a transfer between your accounts). */
export function canEnterArrived(draft: Pick<TransactionDraft, 'kind' | 'accountId' | 'toAccountId' | 'fromPersonId' | 'toPersonId'>): boolean {
  if (draft.kind === 'income') return !!draft.accountId;
  return draft.kind === 'transfer' && !!draft.accountId && !!draft.toAccountId && !draft.fromPersonId && !draft.toPersonId;
}

/** A draft typed as what arrived: works out the amount before fees, then checks it as usual. */
function prepareArrived(db: AppDb, draft: TransactionDraft): AmountResult & { currency: string; amount: DecimalString } {
  if (!canEnterArrived(draft)) invalid('What arrived is for money coming into your account');
  if (!draft.knownAmount || !isDecimalString(draft.knownAmount) || !dec(draft.knownAmount).gt(0)) invalid('Enter what arrived, above zero');
  const currency = draft.kind === 'transfer' ? accountCurrency(db, draft.accountId!) : draft.currency;
  const receivingCurrency = accountCurrency(db, draft.kind === 'transfer' ? draft.toAccountId! : draft.accountId!);
  for (const c of draft.charges ?? []) {
    if (!isDecimalString(c.amount) || dec(c.amount).lte(0)) invalid('A charge needs an amount above zero');
  }
  const amount = amountFromArrived({ arrived: draft.knownAmount, currency, receivingCurrency, rate: draft.rate ?? null, charges: draft.charges });
  const converts = currency !== receivingCurrency;
  const resolved = prepareTransaction(db, {
    ...draft,
    enteredAs: 'sent',
    amount,
    currency,
    // Across currencies, what arrived is the known number (saveTransaction keeps the typed rate).
    rateMode: converts ? 'amount_known' : 'rate_known',
    rate: null,
    knownAmount: converts ? draft.knownAmount : null,
  });
  return resolved;
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
    const arrivedEntry = draft.enteredAs === 'arrived';
    // Across currencies the rate you typed is kept as the rate got (what arrived is exact; the two differ only by rounding).
    const typedRate = arrivedEntry && a.converts ? (draft.rate ?? null) : null;
    if (arrivedEntry) draft = { ...draft, amount: a.amount, rateMode: a.converts ? 'amount_known' : 'rate_known', rate: null, knownAmount: a.converts ? (draft.knownAmount ?? null) : null };
    const split = draft.kind === 'expense' && draft.split ? draft.split : null;
    // Shares are in the currency actually charged: your account's when you paid, the bill's when someone else paid.
    const splitTotal = draft.fromPersonId ? toDecimalString(dec(draft.amount)) : a.accountAmount;
    if (split) checkSplit(split, splitTotal, draft.fromPersonId ?? null);
    const yourShare = split ? split.shares.find((sh) => sh.personId === null)!.amount : null;
    const isPersonTransfer = draft.kind === 'transfer' && (draft.fromPersonId || draft.toPersonId);
    // Only a person transfer can clear a balance in another currency, and only when the currencies differ.
    const personSettle =
      isPersonTransfer && draft.personCurrency && draft.personAmount && draft.personCurrency !== a.currency
        ? (() => {
            if (!isDecimalString(draft.personAmount) || dec(draft.personAmount).lte(0)) throw new DataError('invalid_amount', 'Enter what it clears, above zero');
            if (!isCurrencyCode(draft.personCurrency)) throw new DataError('invalid_currency', 'Unknown currency');
            return { currency: draft.personCurrency, amount: toDecimalString(dec(draft.personAmount)) };
          })()
        : null;

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
      // Someone else paid a split: the expense is your share only (Decided).
      amount: split && draft.fromPersonId ? toDecimalString(dec(yourShare!)) : toDecimalString(dec(draft.amount)),
      currency: a.currency,
      rate: typedRate ?? a.rate,
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
      personCurrency: personSettle ? personSettle.currency : null,
      personAmount: personSettle ? personSettle.amount : null,
      marketRateAtEntry: a.converts ? (options.marketRate?.rate ?? existing?.marketRateAtEntry ?? null) : null,
      marketRateFetchedAt: a.converts ? (options.marketRate?.fetchedAt ?? existing?.marketRateFetchedAt ?? null) : null,
      enteredAs: arrivedEntry ? 'arrived' : null,
      updatedAt: nowIso(),
    };

    if (existing) {
      tx.update(transactions).set(row).where(eq(transactions.id, id)).run();
      tx.delete(transactionCharges).where(eq(transactionCharges.transactionId, id)).run();
      tx.delete(personEntries)
        .where(and(eq(personEntries.transactionId, id), inArray(personEntries.source, ['transfer', 'paid_by_person', 'split'])))
        .run();
      // Editing a split rewrites its shares; repayments stay as their own transfers (Decided Nov 7).
      tx.delete(splitShares).where(eq(splitShares.transactionId, id)).run();
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

    // What a person owes changes only through a transfer with them, a split, or an expense they paid.
    const entry = (personId: string, amount: DecimalString, source: 'transfer' | 'paid_by_person' | 'split', currency = a.currency) =>
      tx.insert(personEntries)
        .values({ id: newId(), personId, transactionId: id, source, currency, amount, date: draft.date })
        .run();
    const negate = (v: DecimalString) => toDecimalString(dec(v).negated());
    // Paid in another currency: the person's balance moves in their currency by what it clears.
    const amount = personSettle ? personSettle.amount : toDecimalString(dec(draft.amount));
    const personCur = personSettle ? personSettle.currency : a.currency;
    if (draft.kind === 'transfer' && draft.toPersonId) entry(draft.toPersonId, amount, 'transfer', personCur);
    if (draft.kind === 'transfer' && draft.fromPersonId) entry(draft.fromPersonId, negate(amount), 'transfer', personCur);

    if (split) {
      const splitCurrency = draft.accountId ? accountCurrency(tx, draft.accountId) : a.currency;
      for (const sh of split.shares) {
        tx.insert(splitShares)
          .values({
            id: newId(),
            transactionId: id,
            personId: sh.personId,
            shareAmount: toDecimalString(dec(sh.amount)),
            sharePercent: split.mode === 'percent' ? (sh.percent ?? null) : null,
            splitMode: split.mode,
            isTreat: sh.personId !== null && !!sh.treat,
          })
          .run();
      }
      if (draft.fromPersonId) {
        // Someone else paid: only your share becomes a debt, to the payer.
        if (dec(yourShare!).gt(0)) entry(draft.fromPersonId, negate(yourShare!), 'split', splitCurrency);
      } else {
        // You paid: everyone else's untreated share is added to what they owe you.
        for (const sh of split.shares) {
          if (sh.personId && !sh.treat && dec(sh.amount).gt(0)) entry(sh.personId, toDecimalString(dec(sh.amount)), 'split', splitCurrency);
        }
      }
    } else if (draft.kind === 'expense' && draft.fromPersonId) {
      entry(draft.fromPersonId, negate(amount), 'paid_by_person');
    }

    // "Sent | Arrived" is remembered per account: the account money comes into (owner, Nov 15).
    if (canEnterArrived(draft)) {
      const into = (draft.kind === 'transfer' ? draft.toAccountId : draft.accountId)!;
      tx.update(accounts).set({ enterArrived: arrivedEntry }).where(eq(accounts.id, into)).run();
    }

    // Paid / Added for a recurring item's due date: the item moves on to its next date.
    if (!existing && draft.recurringId && draft.recurringDueDate && !draft.autoAdded) {
      noteRecurringHandled(tx, draft.recurringId, draft.recurringDueDate, toDecimalString(dec(draft.amount)));
    }

    // Spending that eats into money set aside shrinks the lowest-priority goals first (Decided).
    if (draft.status === 'cleared' && draft.date <= today) {
      for (const acct of new Set([draft.accountId, ...(draft.charges ?? []).map((c) => c.accountId)].filter((x): x is string => !!x))) {
        shrinkGoalsToFit(tx, acct, today);
      }
    }

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
  const split = t.kind === 'expense' ? splitOf(db, id) : null;
  // Someone else paid a split: the stored amount is your share; the form edits the whole bill.
  const amount = split && t.paidByPersonId ? toDecimalString(split.shares.reduce((sum, sh) => sum.plus(dec(sh.amount)), dec('0'))) : t.amount;
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
    amount,
    currency: t.currency,
    ...(t.enteredAs === 'arrived'
      ? // Typed as what arrived: Edit opens the same way, with what arrived (and, across currencies, the rate it implies).
        { enteredAs: 'arrived' as const, rateMode: 'rate_known' as const, rate: t.rate, knownAmount: t.kind === 'transfer' ? t.toAmount : t.accountAmount }
      : {
          rateMode: t.rateMode ?? 'rate_known',
          rate: t.rateMode === 'amount_known' ? null : t.rate,
          knownAmount: t.rateMode === 'amount_known' ? (t.kind === 'transfer' ? t.toAmount : t.accountAmount) : null,
        }),
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
    personCurrency: t.personCurrency,
    personAmount: t.personAmount,
    expectedFromPersonId: t.expectedFromPersonId,
    notes: t.notes,
    recurringId: t.recurringId,
    recurringDueDate: t.recurringDueDate,
    autoAdded: t.autoAdded,
    split,
  };
}
