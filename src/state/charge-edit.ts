import { DEFAULT_DEDUCTION, type ChargeDraft, type ChargeType } from '@/data/transactions';
import { expressionValue, pressKey, type CalcKey } from '@/lib/calc';
import { dec, getCurrency, type DecimalString } from '@/lib/money';

/**
 * The charge being typed on the Charges page (Decided Nov 11, option D): the
 * receipt stays on screen and a panel docked above the keypad edits one charge
 * at a time. The amount is a keypad expression ("530×2.5÷100"); the receipt
 * and "goes up by" use it as soon as it works out to more than zero.
 */
export interface ChargeEdit {
  /** Its place in the form's charges, or null for a new one not added yet. */
  index: number | null;
  type: ChargeType;
  /** Custom types only: the name the user gave it. */
  label: string | null;
  expression: string;
  /** Inside charges: any currency (a rate is asked for when it's a third one). On top: the account's. */
  currency: string;
  deduction: ChargeDraft['deduction'];
  accountId: string | null;
  isTax: boolean;
  /** A stored decimal, for an inside charge in a third currency. */
  rate: DecimalString | null;
}

export interface ChargeContext {
  /** The main amount's currency. */
  mainCurrency: string;
  /** What the main amount converts into, if anything (an inside charge in it needs no rate). */
  receivingCurrency: string;
  /** The account a new on-top charge comes out of by default. */
  defaultAccountId: string | null;
  /** On-top charges take their account's currency. */
  accountCurrency: (accountId: string) => string | undefined;
}

/** Withholding tax is always tax; the switch is locked on for it. */
export const isForcedTax = (type: ChargeType) => type === 'withholding_tax';

/** A new charge of this type, where that type starts (fees inside, taxes and bank charges on top). */
export function newChargeEdit(type: ChargeType, ctx: ChargeContext, label: string | null = null): ChargeEdit {
  const deduction = DEFAULT_DEDUCTION[type];
  return withDeduction(
    { index: null, type, label, expression: '', currency: ctx.mainCurrency, deduction, accountId: ctx.defaultAccountId, isTax: isForcedTax(type), rate: null },
    deduction,
    ctx,
  );
}

/** Opens a saved charge for editing. */
export function editCharge(c: ChargeDraft, index: number): ChargeEdit {
  return {
    index,
    type: c.type,
    label: c.label ?? null,
    expression: c.amount,
    currency: c.currency,
    deduction: c.deduction,
    accountId: c.accountId ?? null,
    isTax: isForcedTax(c.type) || !!c.isTax,
    rate: c.rate ?? null,
  };
}

/** Picking another type: its starting place, and tax switched on for withholding tax. */
export function withType(e: ChargeEdit, type: ChargeType, ctx: ChargeContext, label: string | null = null): ChargeEdit {
  const next = { ...e, type, label: type === 'custom' ? label : null, isTax: isForcedTax(type) || (e.isTax && !isForcedTax(e.type)) };
  // A brand-new charge follows its type's default; one being edited keeps where the user put it.
  return e.index === null && !e.expression ? withDeduction(next, DEFAULT_DEDUCTION[type], ctx) : next;
}

/** Inside or on top. On top uses the account's currency and never a rate. */
export function withDeduction(e: ChargeEdit, deduction: ChargeDraft['deduction'], ctx: ChargeContext): ChargeEdit {
  if (deduction === 'charged_separately') {
    const accountId = e.accountId ?? ctx.defaultAccountId;
    return { ...e, deduction, accountId, currency: (accountId && ctx.accountCurrency(accountId)) || e.currency, rate: null };
  }
  return { ...e, deduction, currency: e.deduction === deduction ? e.currency : ctx.mainCurrency };
}

export function withAccount(e: ChargeEdit, accountId: string, ctx: ChargeContext): ChargeEdit {
  return { ...e, accountId, currency: ctx.accountCurrency(accountId) ?? e.currency };
}

export function pressChargeKey(e: ChargeEdit, key: CalcKey): ChargeEdit {
  return { ...e, expression: pressKey(e.expression, key, getCurrency(e.currency).minorUnits) };
}

export const needsRate = (e: ChargeEdit, ctx: ChargeContext) =>
  e.deduction === 'already_deducted' && e.currency !== ctx.mainCurrency && e.currency !== ctx.receivingCurrency;

/** The amount as it works out now, or null while it's empty, incomplete or zero. */
export function chargeAmount(e: ChargeEdit): DecimalString | null {
  const v = expressionValue(e.expression, getCurrency(e.currency).minorUnits);
  return v && dec(v).gt(0) ? v : null;
}

/** The charge to count, or null while something it needs is missing. */
export function chargeFromEdit(e: ChargeEdit, ctx: ChargeContext): ChargeDraft | null {
  const amount = chargeAmount(e);
  const onTop = e.deduction === 'charged_separately';
  const rate = needsRate(e, ctx) ? e.rate : null;
  if (!amount || (onTop && !e.accountId) || (needsRate(e, ctx) && !(rate && dec(rate).gt(0))) || (e.type === 'custom' && !e.label?.trim())) return null;
  return {
    type: e.type,
    label: e.type === 'custom' ? e.label!.trim() : null,
    amount,
    currency: e.currency,
    deduction: e.deduction,
    rate,
    rateMode: rate ? 'rate_known' : null,
    accountId: onTop ? e.accountId : null,
    isTax: isForcedTax(e.type) || e.isTax,
  };
}

/**
 * The charges as they stand while one is being edited: the edited one in its
 * place when it's complete, left out while it isn't (so nothing half-typed is
 * counted or saved).
 */
export function liveCharges(charges: ChargeDraft[], e: ChargeEdit | null, ctx: ChargeContext): ChargeDraft[] {
  if (!e) return charges;
  const current = chargeFromEdit(e, ctx);
  if (e.index === null) return current ? [...charges, current] : charges;
  return charges.flatMap((c, i) => (i === e.index ? (current ? [current] : []) : [c]));
}

/**
 * The charges to keep when the editor closes (another line tapped, back to the
 * form, or ✓): a finished edit replaces or adds; an unfinished one changes
 * nothing, so clearing a saved charge's amount and leaving never loses it.
 * The bin removes a charge.
 */
export function commitCharges(charges: ChargeDraft[], e: ChargeEdit | null, ctx: ChargeContext): ChargeDraft[] {
  if (!e) return charges;
  const current = chargeFromEdit(e, ctx);
  if (!current) return charges;
  return e.index === null ? [...charges, current] : charges.map((c, i) => (i === e.index ? current : c));
}
