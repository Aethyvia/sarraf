import type { RateMode } from '@/data/amounts';
import { equalShares, percentShares, type SplitDraft } from '@/data/splits';
import type { ChargeDraft, TransactionDraft } from '@/data/transactions';
import { pressKey, type CalcKey } from '@/lib/calc';
import type { PickedFile } from '@/services/attachments';

export type FormKind = 'expense' | 'income' | 'transfer' | 'savings';
export type Side = { type: 'account' | 'person'; id: string } | null;

/** Everything Add transaction holds while it's open. */
export interface FormState {
  kind: FormKind;
  /** The main amount as typed on the keypad (may be an expression). */
  expression: string;
  /** "I know what was charged / received", typed on the keypad. */
  knownExpression: string;
  /** Which number the keypad is typing into: the amount, what was charged/received, or the rate. */
  target: 'amount' | 'known' | 'rate';
  /** The main amount's currency for an expense or income; null = the account's. */
  currency: string | null;
  /** Expense: paid from. Income: received into. Transfer: From. */
  from: Side;
  /** Transfer: To. */
  to: Side;
  categoryId: string | null;
  referencePersonId: string | null;
  status: 'cleared' | 'pending' | 'in_transit';
  expectedDate: string | null;
  date: string;
  ledgerId: string | null;
  reimbursable: boolean;
  expectedFromPersonId: string | null;
  rateMode: RateMode;
  /** The rate as typed on the keypad (may be an expression); 1 main = rate receiving. */
  rateText: string;
  charges: ChargeDraft[];
  notes: string;
  /** New files to attach on save, and saved attachments to remove. */
  attachments: { picked: PickedFile[]; removeIds: string[] };
  /** Savings: the goal and the account it's set aside from. */
  goalId: string | null;
  goalAccountId: string | null;
  /** Expense: split with people. Who paid follows `from` (an account = you; a person = they did). */
  split: SplitDraft | null;
  /** Pay / Add from a recurring item: which item and due date this handles. */
  recurringId: string | null;
  recurringDueDate: string | null;
  /** A settlement paid in another currency: what it clears in the person's currency (kept as is on edit). */
  personSettle: { currency: string; amount: string } | null;
  /**
   * "Before fees | Arrived" (owner, Nov 15): income or a transfer between your accounts typed as
   * what arrived. Same currency: `expression` is what arrived. Across currencies: `knownExpression`
   * is what arrived and `rateText` the rate; the amount before fees is worked out.
   */
  enterArrived: boolean;
}

/** Whether "Before fees | Arrived" applies: money coming into one of your accounts. */
export function arrivedApplies(s: Pick<FormState, 'kind' | 'from' | 'to'>): boolean {
  if (s.kind === 'income') return s.from?.type === 'account';
  return s.kind === 'transfer' && s.from?.type === 'account' && s.to?.type === 'account';
}

/** Typed as what arrived, and it applies. */
export const isArrivedEntry = (s: FormState) => s.enterArrived && arrivedApplies(s);

/**
 * Switches between "Before fees" and "Arrived". The typed number stays; across currencies the
 * keypad moves to what arrived (Arrived) or the amount (Before fees), and the rate is the typed one.
 */
export function setEnterArrived(state: FormState, on: boolean, converts: boolean): FormState {
  if (state.enterArrived === on) return state;
  if (!converts) return { ...state, enterArrived: on };
  return on
    ? { ...state, enterArrived: true, rateMode: 'rate_known', target: 'known', knownExpression: state.rateMode === 'amount_known' ? state.knownExpression : '' }
    : { ...state, enterArrived: false, target: 'amount' };
}

export function initialForm(defaults: { date: string; ledgerId: string | null; accountId: string | null; kind?: FormKind }): FormState {
  return {
    kind: defaults.kind ?? 'expense',
    expression: '',
    knownExpression: '',
    target: 'amount',
    currency: null,
    from: defaults.accountId ? { type: 'account', id: defaults.accountId } : null,
    to: null,
    categoryId: null,
    referencePersonId: null,
    status: 'cleared',
    expectedDate: null,
    date: defaults.date,
    ledgerId: defaults.ledgerId,
    reimbursable: false,
    expectedFromPersonId: null,
    rateMode: 'rate_known',
    rateText: '',
    charges: [],
    notes: '',
    attachments: { picked: [], removeIds: [] },
    goalId: null,
    goalAccountId: null,
    split: null,
    recurringId: null,
    recurringDueDate: null,
    personSettle: null,
    enterArrived: false,
  };
}

/**
 * Switching kind (Decided): only the ledger, charges, notes and attachments
 * carry over, and they keep their state across any number of switches until
 * the draft is saved or discarded. Everything else starts fresh. Savings has no
 * charges or ledger, so they're kept aside and come back on the next kind that has them.
 */
export function switchKind(state: FormState, kind: FormKind, defaults: { date: string; accountId: string | null }): FormState {
  if (kind === state.kind) return state;
  return {
    ...initialForm({ date: defaults.date, ledgerId: state.ledgerId, accountId: defaults.accountId, kind }),
    ledgerId: state.ledgerId,
    charges: state.charges,
    notes: state.notes,
    attachments: state.attachments,
  };
}

/** Places a typed rate may have. */
export const RATE_MAX_DECIMALS = 10;

/**
 * Money in another currency (option D, Owner Nov 12): tapping one of the three
 * numbers points the keypad at it. Tapping the worked-out one (the rate or what
 * was charged/received) makes it the typed one, starting empty; the other is
 * then worked out instead. No "I know the rate / amount" switch.
 */
export function focusConversion(state: FormState, slot: 'amount' | 'rate' | 'known'): FormState {
  // Typed as what arrived: the amount before fees is worked out; the rate and what arrived are typed.
  if (isArrivedEntry(state)) return slot === 'amount' ? state : { ...state, target: slot };
  if (slot === 'amount') return { ...state, target: 'amount' };
  if (slot === 'rate') {
    return state.rateMode === 'rate_known' ? { ...state, target: 'rate' } : { ...state, rateMode: 'rate_known', rateText: '', target: 'rate' };
  }
  return state.rateMode === 'amount_known' ? { ...state, target: 'known' } : { ...state, rateMode: 'amount_known', knownExpression: '', target: 'known' };
}

/** A key on the keypad, applied to whichever number it's typing into. */
export function applyKey(state: FormState, key: CalcKey, maxDecimals: number): FormState {
  if (state.target === 'known') return { ...state, knownExpression: pressKey(state.knownExpression, key, maxDecimals) };
  if (state.target === 'rate') return { ...state, rateText: pressKey(state.rateText, key, RATE_MAX_DECIMALS) };
  return { ...state, expression: pressKey(state.expression, key, maxDecimals) };
}

/** Loads a saved transaction into the form, for Edit and "Edit and add transaction". */
export function formFromDraft(d: TransactionDraft): FormState {
  const from: Side = d.accountId ? { type: 'account', id: d.accountId } : d.fromPersonId ? { type: 'person', id: d.fromPersonId } : null;
  const to: Side = d.toAccountId ? { type: 'account', id: d.toAccountId } : d.toPersonId ? { type: 'person', id: d.toPersonId } : null;
  return {
    kind: d.kind,
    expression: d.amount,
    knownExpression: d.knownAmount ?? '',
    target: 'amount',
    currency: d.kind === 'transfer' ? null : d.currency,
    from,
    to,
    categoryId: d.categoryId ?? null,
    referencePersonId: d.referencePersonId ?? null,
    status: d.status,
    expectedDate: d.expectedDate ?? null,
    date: d.date,
    ledgerId: d.ledgerId ?? null,
    reimbursable: !!d.reimbursable,
    expectedFromPersonId: d.expectedFromPersonId ?? null,
    rateMode: d.rateMode ?? 'rate_known',
    rateText: d.rate ?? '',
    charges: d.charges ?? [],
    notes: d.notes ?? '',
    attachments: { picked: [], removeIds: [] },
    goalId: null,
    goalAccountId: null,
    split: d.split ?? null,
    recurringId: d.recurringId ?? null,
    recurringDueDate: d.recurringDueDate ?? null,
    personSettle: d.personCurrency && d.personAmount ? { currency: d.personCurrency, amount: d.personAmount } : null,
    ...(d.enteredAs === 'arrived' && d.knownAmount
      ? // What arrived goes in both places: the amount (same currency) or what arrived (across currencies).
        { enterArrived: true, expression: d.knownAmount, knownExpression: d.knownAmount, rateMode: 'rate_known' as const, rateText: d.rate ?? '', target: 'known' as const }
      : { enterArrived: false }),
  };
}

/**
 * A split re-fitted to the current total: Equal and Percent shares follow the
 * amount; Amounts stay as typed (and must be fixed if they no longer add up).
 */
export function splitForTotal(split: SplitDraft, total: string, currency: string): SplitDraft {
  if (split.mode === 'equal') {
    const amounts = equalShares(total, split.shares.length, currency);
    return { ...split, shares: split.shares.map((sh, i) => ({ ...sh, amount: amounts[i] })) };
  }
  if (split.mode === 'percent') {
    const amounts = percentShares(total, split.shares.map((sh) => sh.percent ?? '0'), currency);
    return { ...split, shares: split.shares.map((sh, i) => ({ ...sh, amount: amounts[i] })) };
  }
  return split;
}

/** The draft to save, from the form and its worked-out amount. */
export function draftFromForm(
  s: FormState,
  values: { amount: string; knownAmount: string | null; rate: string | null; mainCurrency: string; converts?: boolean },
): TransactionDraft {
  if (s.kind === 'savings') throw new Error('Savings is not a transaction');
  const arrived = isArrivedEntry(s);
  return {
    kind: s.kind,
    date: s.date,
    status: s.status,
    expectedDate: s.status === 'pending' ? s.expectedDate : null,
    ledgerId: s.ledgerId,
    categoryId: s.kind === 'transfer' ? null : s.categoryId,
    referencePersonId: s.referencePersonId,
    accountId: s.from?.type === 'account' ? s.from.id : null,
    fromPersonId: s.kind !== 'income' && s.from?.type === 'person' ? s.from.id : null,
    toAccountId: s.kind === 'transfer' && s.to?.type === 'account' ? s.to.id : null,
    toPersonId: s.kind === 'transfer' && s.to?.type === 'person' ? s.to.id : null,
    amount: values.amount,
    currency: values.mainCurrency,
    ...(arrived
      ? // What arrived: the amount typed (same currency) or the known amount (across currencies).
        { enteredAs: 'arrived' as const, rateMode: 'rate_known' as const, rate: values.converts ? values.rate : null, knownAmount: values.converts ? values.knownAmount : values.amount }
      : {
          rateMode: s.rateMode,
          rate: s.rateMode === 'rate_known' ? values.rate : null,
          knownAmount: s.rateMode === 'amount_known' ? values.knownAmount : null,
        }),
    charges: s.charges,
    reimbursable: s.kind === 'expense' && s.reimbursable,
    expectedFromPersonId: s.kind === 'expense' && s.reimbursable ? s.expectedFromPersonId : null,
    notes: s.notes,
    split: s.kind === 'expense' ? s.split : null,
    recurringId: s.recurringId,
    recurringDueDate: s.recurringDueDate,
    // Still a transfer with a person: it keeps clearing the same amount in their currency.
    personCurrency: s.kind === 'transfer' && s.personSettle && (s.from?.type === 'person' || s.to?.type === 'person') ? s.personSettle.currency : null,
    personAmount: s.kind === 'transfer' && s.personSettle && (s.from?.type === 'person' || s.to?.type === 'person') ? s.personSettle.amount : null,
  };
}
