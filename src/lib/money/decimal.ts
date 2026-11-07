import DecimalBase from 'decimal.js';

/**
 * The one Decimal constructor for money in Sarraf.
 *
 * - Amounts are exact decimal strings everywhere (never JS numbers).
 * - precision is the number of significant digits kept by * and /; 200 is far
 *   beyond any real amount, so there is effectively no upper limit.
 * - Rounding is half-to-even, and only happens where a caller asks for it
 *   (see roundToMinor), never implicitly.
 * - toExpNeg/toExpPos keep toString()/toFixed() from ever using exponent
 *   notation, so stored strings are always plain digits.
 */
export const Decimal = DecimalBase.clone({
  precision: 200,
  rounding: DecimalBase.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

export type DecimalValue = InstanceType<typeof Decimal>;

/** A stored money value: an exact decimal string such as "104231.75" or "-30". */
export type DecimalString = string;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/** True when `value` is a plain decimal string Sarraf can store. */
export function isDecimalString(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

/** Parses a stored decimal string. Throws on anything that isn't a plain decimal. */
export function dec(value: DecimalString | DecimalValue): DecimalValue {
  if (value instanceof Decimal) return value;
  if (!isDecimalString(value)) {
    throw new Error(`Not a decimal string: "${value}"`);
  }
  return new Decimal(value);
}

/** Serialises a Decimal for storage: plain digits, no exponent, no trailing zeros, "0" not "-0". */
export function toDecimalString(value: DecimalValue): DecimalString {
  if (value.isZero()) return '0';
  return value.toFixed();
}

export function add(...values: (DecimalString | DecimalValue)[]): DecimalString {
  return toDecimalString(values.reduce<DecimalValue>((sum, v) => sum.plus(dec(v)), new Decimal(0)));
}

export function sub(a: DecimalString | DecimalValue, b: DecimalString | DecimalValue): DecimalString {
  return toDecimalString(dec(a).minus(dec(b)));
}

export function compare(a: DecimalString | DecimalValue, b: DecimalString | DecimalValue): -1 | 0 | 1 {
  return dec(a).comparedTo(dec(b)) as -1 | 0 | 1;
}
