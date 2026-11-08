import { Decimal, dec, type DecimalValue, type DecimalString } from './decimal';
import { getCurrency } from './currencies';

/** The five number formats in Settings → Number format. */
export const NUMBER_FORMATS = ['1,000.00', '1.000,00', '1 000,00', '1 000.00', "1'000.00"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

const NBSP = ' ';
/** The minus sign used on every screen (U+2212), not a hyphen. */
export const MINUS = '−';

interface Separators {
  group: string;
  decimal: string;
}

const SEPARATORS: Record<NumberFormat, Separators> = {
  '1,000.00': { group: ',', decimal: '.' },
  '1.000,00': { group: '.', decimal: ',' },
  '1 000,00': { group: NBSP, decimal: ',' },
  '1 000.00': { group: NBSP, decimal: '.' },
  "1'000.00": { group: "'", decimal: '.' },
};

/** PKR always uses South Asian (lakh) grouping with "," and ".", whatever format is chosen. */
const LAKH_CURRENCIES = new Set(['PKR']);

export interface FormatOptions {
  numberFormat?: NumberFormat;
  /** Shorten amounts of 1 million or more to M / B / T (Settings: compact numbers). */
  compact?: boolean;
  /** 'auto': "−" on negatives only. 'always': "+" on positives too (In/Out, person balances). 'never': no sign. */
  sign?: 'auto' | 'always' | 'never' | 'minus';
  /** Prefix the symbol or code. Off for bare numbers such as an amount next to a currency badge. */
  showCurrency?: boolean;
}

export interface FormattedAmount {
  text: string;
  /** True when the amount was shortened (M / B / T): show the dashed underline and tap-for-exact. */
  isCompact: boolean;
}

/** Groups an integer digit string: western groups of 3, or lakh (3 then 2s). */
function groupDigits(digits: string, group: string, lakh: boolean): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const size = lakh ? 2 : 3;
  const parts: string[] = [];
  for (let end = rest.length; end > 0; end -= size) {
    parts.unshift(rest.slice(Math.max(0, end - size), end));
  }
  return [...parts, last3].join(group);
}

function separatorsFor(currency: string, numberFormat: NumberFormat): Separators & { lakh: boolean } {
  if (LAKH_CURRENCIES.has(currency)) return { group: ',', decimal: '.', lakh: true };
  return { ...SEPARATORS[numberFormat], lakh: false };
}

/**
 * Plain digits for an exact amount: at least the currency's minor units, and
 * any further digits that are stored (never rounded for display).
 */
function exactNumber(abs: DecimalValue, currency: string, seps: Separators & { lakh: boolean }): string {
  const minor = getCurrency(currency).minorUnits;
  const places = Math.max(minor, abs.decimalPlaces());
  const [int, frac] = abs.toFixed(places).split('.');
  const grouped = groupDigits(int, seps.group, seps.lakh);
  return frac ? `${grouped}${seps.decimal}${frac}` : grouped;
}

const COMPACT_UNITS = [
  { suffix: 'T', size: new Decimal('1e12') },
  { suffix: 'B', size: new Decimal('1e9') },
  { suffix: 'M', size: new Decimal('1e6') },
] as const;

/**
 * Short form for 1M and up: up to two decimals, cut (not rounded), trailing
 * zeros dropped. Past T the number before T keeps growing ("4,560T").
 */
function compactNumber(abs: DecimalValue, seps: Separators & { lakh: boolean }): string | null {
  const unit = COMPACT_UNITS.find((u) => abs.greaterThanOrEqualTo(u.size));
  if (!unit) return null;
  const cut = abs.dividedBy(unit.size).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const [int, frac = ''] = cut.toFixed(2).split('.');
  const trimmed = frac.replace(/0+$/, '');
  const grouped = groupDigits(int, seps.group, seps.lakh);
  return `${trimmed ? `${grouped}${seps.decimal}${trimmed}` : grouped}${unit.suffix}`;
}

function currencyPrefix(currency: string): string {
  const { symbol, code } = getCurrency(currency);
  return symbol ?? `${code}${NBSP}`;
}

/**
 * Formats a stored amount for display. Every amount on screen goes through this
 * (via the Money component), so formatting is the same everywhere.
 */
export function formatAmount(
  value: DecimalString,
  currency: string,
  { numberFormat = '1,000.00', compact = false, sign = 'auto', showCurrency = true }: FormatOptions = {},
): FormattedAmount {
  const d = dec(value);
  const abs = d.abs();
  const seps = separatorsFor(currency, numberFormat);

  const short = compact ? compactNumber(abs, seps) : null;
  const number = short ?? exactNumber(abs, currency, seps);

  let signText = '';
  if (sign !== 'never') {
    if (sign === 'minus' || (d.isNegative() && !d.isZero())) signText = MINUS;
    else if (sign === 'always') signText = '+';
  }

  return {
    text: `${signText}${showCurrency ? currencyPrefix(currency) : ''}${number}`,
    isCompact: short !== null,
  };
}

/** The exact form, for the tap-to-reveal bubble and copy. */
export function formatExact(
  value: DecimalString,
  currency: string,
  options: Omit<FormatOptions, 'compact'> = {},
): string {
  return formatAmount(value, currency, { ...options, compact: false }).text;
}

/**
 * Formats a number while it's being typed: groups the whole part in the chosen
 * format (lakh for PKR) but keeps the decimals exactly as typed, including a
 * trailing point ("1,563." → still typing). Operators get thin spaces around them.
 */
export function formatTyped(expression: string, currency: string, numberFormat: NumberFormat = '1,000.00'): string {
  const seps = separatorsFor(currency, numberFormat);
  return expression.replace(/[0-9]+(\.[0-9]*)?|\.[0-9]+/g, (n) => {
    const [int, frac] = n.split('.');
    const grouped = groupDigits(int || '0', seps.group, seps.lakh);
    return frac === undefined ? grouped : `${grouped}${seps.decimal}${frac}`;
  }).replace(/([+−×÷])/g, (op, _m, offset: number) => (offset === 0 ? op : ` ${op} `));
}
