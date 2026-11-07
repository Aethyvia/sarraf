import { Decimal, dec, type DecimalValue, toDecimalString, type DecimalString } from './decimal';
import { minorUnits } from './currencies';

/**
 * Rounds to the currency's ISO 4217 minor units, half-to-even.
 * Only used when storing a converted amount; typed amounts are stored as typed.
 */
export function roundToMinor(value: DecimalString | DecimalValue, currency: string): DecimalString {
  return toDecimalString(dec(value).toDecimalPlaces(minorUnits(currency), Decimal.ROUND_HALF_EVEN));
}

/**
 * Converts `amount` at `rate` (1 unit of the amount's currency = `rate` units of
 * `toCurrency`) and rounds once, to `toCurrency`'s minor units.
 */
export function convert(amount: DecimalString, rate: DecimalString, toCurrency: string): DecimalString {
  return roundToMinor(dec(amount).times(dec(rate)), toCurrency);
}

/** Decimal places kept on a rate worked out from two amounts ("I know what was charged"). */
export const DERIVED_RATE_PLACES = 10;

/**
 * The rate implied by two amounts: `to` ÷ `from`, half-to-even to DERIVED_RATE_PLACES.
 * The amounts themselves are what get stored and summed; the rate is for display and "vs market".
 */
export function rateFromAmounts(from: DecimalString, to: DecimalString): DecimalString {
  const f = dec(from);
  if (f.isZero()) throw new Error('Cannot work out a rate from a zero amount');
  return toDecimalString(dec(to).dividedBy(f).toDecimalPlaces(DERIVED_RATE_PLACES, Decimal.ROUND_HALF_EVEN));
}
