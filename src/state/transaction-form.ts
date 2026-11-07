import type { RateMode } from '@/data/amounts';
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
  /** Which number the keypad is typing into. */
  target: 'amount' | 'known';
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
  rateText: string;
  charges: ChargeDraft[];
  notes: string;
  /** New files to attach on save, and saved attachments to remove. */
  attachments: { picked: PickedFile[]; removeIds: string[] };
  /** Savings: the goal and the account it's set aside from. */
  goalId: string | null;
  goalAccountId: string | null;
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

/** A key on the keypad, applied to whichever number it's typing into. */
export function applyKey(state: FormState, key: CalcKey, maxDecimals: number): FormState {
  if (state.target === 'known') return { ...state, knownExpression: pressKey(state.knownExpression, key, maxDecimals) };
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
  };
}

/** The draft to save, from the form and its worked-out amount. */
export function draftFromForm(
  s: FormState,
  values: { amount: string; knownAmount: string | null; rate: string | null; mainCurrency: string },
): TransactionDraft {
  if (s.kind === 'savings') throw new Error('Savings is not a transaction');
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
    rateMode: s.rateMode,
    rate: s.rateMode === 'rate_known' ? values.rate : null,
    knownAmount: s.rateMode === 'amount_known' ? values.knownAmount : null,
    charges: s.charges,
    reimbursable: s.kind === 'expense' && s.reimbursable,
    expectedFromPersonId: s.kind === 'expense' && s.reimbursable ? s.expectedFromPersonId : null,
    notes: s.notes,
  };
}
