import { dec, isDecimalString, toDecimalString, type DecimalString } from './decimal';
import type { NumberFormat } from './format';

/**
 * Reads an amount the user typed into a plain decimal string, or null if it
 * isn't one. Accepts the chosen format's decimal separator (and "."), a leading
 * minus, and ignores spaces, apostrophes and the other format's group separator.
 * Exact: no rounding, no upper limit.
 */
export function parseTypedAmount(text: string, numberFormat: NumberFormat = '1,000.00'): DecimalString | null {
  const decimalIsComma = numberFormat.endsWith(',00');
  let s = text.trim().replace(/[\s '’]/g, '').replace(/^[−–]/, '-');
  if (decimalIsComma) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  if (s.startsWith('.')) s = `0${s}`;
  if (s.startsWith('-.')) s = `-0${s.slice(1)}`;
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (!isDecimalString(s)) return null;
  return toDecimalString(dec(s));
}

/** A stored decimal shown in a text field in the user's format, so parseTypedAmount reads it back unchanged. */
export function toTypedText(value: DecimalString | null | undefined, numberFormat: NumberFormat = '1,000.00'): string {
  if (!value) return '';
  return numberFormat.endsWith(',00') ? value.replace('.', ',') : value;
}
