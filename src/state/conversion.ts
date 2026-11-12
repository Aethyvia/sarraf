import { Decimal, dec, rateFromAmounts, roundToMinor, type DecimalString } from '@/lib/money';

/**
 * Three linked numbers (option D, Owner Nov 12) for money back and settling:
 * an amount X (always typed), the other amount Y, and the rate between them.
 * You type the rate or Y; the other is worked out. The rate reads with the
 * stronger currency first ("1 USD = 278.00 PKR"), so `rateFromY` says which
 * way it's written: true → 1 Y = rate X; false → 1 X = rate Y.
 */
export interface Linked {
  x: DecimalString | null;
  known: 'rate' | 'y';
  rate: DecimalString | null;
  y: DecimalString | null;
  curY: string;
  rateFromY: boolean;
}

/** Works out the number you didn't type. Y is rounded once, half-to-even, to its currency. */
export function workOut(p: Linked): { rate: DecimalString | null; y: DecimalString | null } {
  if (p.known === 'rate') {
    if (!p.x || !p.rate || !dec(p.rate).gt(0)) return { rate: p.rate, y: null };
    const y = p.rateFromY ? dec(p.x).dividedBy(dec(p.rate)) : dec(p.x).times(dec(p.rate));
    return { rate: p.rate, y: roundToMinor(y.toDecimalPlaces(20, Decimal.ROUND_HALF_EVEN), p.curY) };
  }
  if (!p.x || !p.y || dec(p.x).isZero() || dec(p.y).isZero()) return { rate: null, y: p.y };
  return { rate: p.rateFromY ? rateFromAmounts(p.y, p.x) : rateFromAmounts(p.x, p.y), y: p.y };
}

/**
 * Which way to write the rate: the stronger currency first. `xPerY` is how many
 * X one Y buys (a market rate), when known; without one, Y goes first.
 */
export function rateFromYFirst(xPerY: DecimalString | null): boolean {
  return xPerY === null || dec(xPerY).gte(1);
}
