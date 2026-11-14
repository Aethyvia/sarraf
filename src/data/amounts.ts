/**
 * The arithmetic behind Add transaction (Spec §11, §11a — Decided). Pure: no
 * database, so every rule is unit-tested.
 *
 * - The main amount means one fixed thing per kind: income = before deductions;
 *   transfer and expense = exactly what left the account.
 * - Inside charges ("already deducted") lower what arrives and never move a
 *   balance on their own. One in the receiving currency is taken off after
 *   conversion; one in any other currency is first converted into the main
 *   amount's currency at its own rate.
 * - On-top charges ("charged separately") come out of their own account, in that
 *   account's currency, and never have a rate.
 * - Converted amounts are rounded once, to the target currency's minor units, half-to-even.
 */
import {
  Decimal,
  convert,
  dec,
  rateFromAmounts,
  roundToMinor,
  toDecimalString,
  type DecimalString,
  type DecimalValue,
} from '@/lib/money';

export type AmountKind = 'expense' | 'income' | 'transfer';
export type RateMode = 'rate_known' | 'amount_known';

export interface ChargeInput {
  amount: DecimalString;
  currency: string;
  deduction: 'already_deducted' | 'charged_separately';
  /** Inside charges in a third currency: 1 unit of the charge's currency = rate units of the main amount's currency. */
  rate?: DecimalString | null;
  /** On-top charges: the account it comes out of. */
  accountId?: string | null;
}

export interface AmountInput {
  kind: AmountKind;
  /** The main amount as typed. */
  amount: DecimalString;
  /** Its currency (for a transfer, always the From account's currency). */
  currency: string;
  /**
   * The currency the amount converts into: the account's for an expense or
   * income, the To account's for a transfer.
   */
  receivingCurrency: string;
  /** The account that receives (income) or the To account (transfer), to find on-top charges against it. */
  receivingAccountId?: string | null;
  rateMode: RateMode;
  /** "I know the rate": 1 unit of `currency` = rate units of `receivingCurrency`. */
  rate?: DecimalString | null;
  /**
   * "I know what was charged / received": for an expense, what left the account;
   * for income or a transfer, what arrived.
   */
  knownAmount?: DecimalString | null;
  charges?: ChargeInput[];
}

export interface AmountResult {
  /** True when the main amount converts into another currency. */
  converts: boolean;
  /** The rate actually got (stored), or null when there's no conversion. */
  rate: DecimalString | null;
  /** Expense: what left the account. Income: what arrived. Transfer: what left From (= the amount). */
  accountAmount: DecimalString;
  /** Transfer only: what reached the To account. */
  toAmount: DecimalString | null;
  /** Income / transfer: the amount before deductions minus inside charges, in the main currency. */
  afterInside: DecimalString | null;
  /** Income / transfer: what arrives in the receiving account. */
  arrives: DecimalString | null;
  /** Income / transfer, display only: what the receiving account really goes up by (arrives − on-top charges on it). */
  netAmount: DecimalString | null;
}

export class AmountError extends Error {
  constructor(
    readonly code: 'rate_required' | 'known_amount_required' | 'charge_rate_required' | 'invalid_amount' | 'charges_exceed',
    message: string,
  ) {
    super(message);
    this.name = 'AmountError';
  }
}

const sum = (values: DecimalValue[]) => values.reduce((a, b) => a.plus(b), new Decimal(0));

/** An inside charge's value in the main amount's currency (not for charges in the receiving currency). */
export function insideChargeInMain(charge: ChargeInput, mainCurrency: string): DecimalValue {
  if (charge.currency === mainCurrency) return dec(charge.amount);
  if (!charge.rate) throw new AmountError('charge_rate_required', `A ${charge.currency} charge needs a rate into ${mainCurrency}`);
  return dec(convert(charge.amount, charge.rate, mainCurrency));
}

export function computeAmounts(input: AmountInput): AmountResult {
  const amount = dec(input.amount);
  if (amount.isNegative()) throw new AmountError('invalid_amount', 'The amount is negative');
  const converts = input.currency !== input.receivingCurrency;
  const charges = input.charges ?? [];
  const inside = charges.filter((c) => c.deduction === 'already_deducted');

  const needRate = () => {
    if (input.rateMode === 'rate_known') {
      if (!input.rate || dec(input.rate).lte(0)) throw new AmountError('rate_required', 'Enter the rate you got');
      return input.rate;
    }
    return null;
  };
  const needKnown = () => {
    if (!input.knownAmount) throw new AmountError('known_amount_required', 'Enter the amount');
    return input.knownAmount;
  };

  // A charge on its own (owner, Nov 14): the amount is 0 and only separate charges move money. Nothing converts.
  if (amount.isZero()) {
    if (inside.length) throw new AmountError('charges_exceed', 'The included charges are more than the amount');
    const here = charges.filter((c) => c.deduction === 'charged_separately' && c.accountId && c.accountId === input.receivingAccountId);
    const money = input.kind === 'expense' ? null : '0';
    return {
      converts,
      rate: null,
      accountAmount: '0',
      toAmount: input.kind === 'transfer' ? '0' : null,
      afterInside: money,
      arrives: money,
      netAmount: money === null ? null : toDecimalString(dec('0').minus(sum(here.map((c) => dec(c.amount))))),
    };
  }

  if (input.kind === 'expense') {
    // Inside charges are only a breakdown of what left the account.
    for (const c of inside) if (c.currency !== input.receivingCurrency) insideChargeInMain(c, input.currency);
    if (!converts) {
      return { converts, rate: null, accountAmount: toDecimalString(amount), toAmount: null, afterInside: null, arrives: null, netAmount: null };
    }
    const rate = needRate();
    if (rate) {
      return { converts, rate, accountAmount: convert(input.amount, rate, input.receivingCurrency), toAmount: null, afterInside: null, arrives: null, netAmount: null };
    }
    const charged = needKnown();
    return {
      converts,
      rate: amount.isZero() ? null : rateFromAmounts(input.amount, charged),
      accountAmount: toDecimalString(dec(charged)),
      toAmount: null,
      afterInside: null,
      arrives: null,
      netAmount: null,
    };
  }

  // Income and transfer: what arrives.
  // With a conversion, inside charges in the receiving currency come off after it; all others before.
  const beforeConversion = converts ? inside.filter((c) => c.currency !== input.receivingCurrency) : inside;
  const afterConversion = converts ? inside.filter((c) => c.currency === input.receivingCurrency) : [];
  const insideMain = sum(beforeConversion.map((c) => insideChargeInMain(c, input.currency)));
  const insideReceiving = sum(afterConversion.map((c) => dec(c.amount)));
  const afterInside = amount.minus(insideMain);

  let rate: DecimalString | null = null;
  let arrives: DecimalValue;
  if (!converts) {
    arrives = afterInside;
  } else {
    const r = needRate();
    if (r) {
      rate = r;
      arrives = dec(convert(toDecimalString(afterInside), r, input.receivingCurrency)).minus(insideReceiving);
    } else {
      arrives = dec(needKnown());
      const beforeReceivingCharges = arrives.plus(insideReceiving);
      rate = afterInside.isZero() ? null : rateFromAmounts(toDecimalString(afterInside), toDecimalString(beforeReceivingCharges));
    }
  }

  // Deducted charges can't take more than there is (council, owner Nov 13): Save waits until they fit.
  if (arrives.isNegative()) throw new AmountError('charges_exceed', 'The deducted charges are more than the amount');

  const onTopOnReceiving = sum(
    charges
      .filter((c) => c.deduction === 'charged_separately' && c.accountId && c.accountId === input.receivingAccountId)
      .map((c) => dec(c.amount)),
  );
  const arrivesText = toDecimalString(arrives);
  return {
    converts,
    rate,
    accountAmount: input.kind === 'income' ? arrivesText : toDecimalString(amount),
    toAmount: input.kind === 'transfer' ? arrivesText : null,
    afterInside: toDecimalString(afterInside),
    arrives: arrivesText,
    netAmount: toDecimalString(arrives.minus(onTopOnReceiving)),
  };
}

/**
 * "What arrived" (owner, Nov 15): income or a transfer typed as the number the bank or
 * Payoneer shows. Works out the amount before fees (what Sarraf stores as the amount)
 * from the included charges, so that what arrives is exactly what was typed.
 * - No conversion: amount = arrived + included charges.
 * - With a conversion (rate typed): arrived + included charges in the receiving currency,
 *   converted back at the rate (rounded to the main currency's minor units), plus the
 *   included charges in other currencies. Saved as "what arrived is known", so the
 *   arrived amount stays exact; the rate you typed is kept as the rate got.
 */
export interface ArrivedInput {
  /** What arrived, in the receiving currency. */
  arrived: DecimalString;
  currency: string;
  receivingCurrency: string;
  /** With a conversion: 1 unit of `currency` = rate units of `receivingCurrency`. */
  rate?: DecimalString | null;
  charges?: ChargeInput[];
}

export function amountFromArrived(input: ArrivedInput): DecimalString {
  const arrived = dec(input.arrived);
  if (!arrived.gt(0)) throw new AmountError('invalid_amount', 'Enter what arrived, above zero');
  const converts = input.currency !== input.receivingCurrency;
  const inside = (input.charges ?? []).filter((c) => c.deduction === 'already_deducted');
  const beforeConversion = converts ? inside.filter((c) => c.currency !== input.receivingCurrency) : inside;
  const afterConversion = converts ? inside.filter((c) => c.currency === input.receivingCurrency) : [];
  const insideMain = sum(beforeConversion.map((c) => insideChargeInMain(c, input.currency)));
  if (!converts) return toDecimalString(arrived.plus(insideMain));
  if (!input.rate || dec(input.rate).lte(0)) throw new AmountError('rate_required', 'Enter the rate you got');
  const beforeReceivingCharges = arrived.plus(sum(afterConversion.map((c) => dec(c.amount))));
  const afterInside = dec(roundToMinor(beforeReceivingCharges.div(dec(input.rate)), input.currency));
  if (!afterInside.gt(0)) throw new AmountError('invalid_amount', 'That rate is too small for this amount');
  return toDecimalString(afterInside.plus(insideMain));
}

/** "−0.2% vs market": how the rate got compares with the market rate, to one decimal. Null without a market rate. */
export function vsMarketPercent(rate: DecimalString | null, market: DecimalString | null): DecimalString | null {
  if (!rate || !market || dec(market).isZero()) return null;
  return toDecimalString(dec(rate).minus(dec(market)).dividedBy(dec(market)).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_EVEN));
}
