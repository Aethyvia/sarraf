import { eq } from 'drizzle-orm';

import { splitShares } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { Decimal, dec, minorUnits, roundToMinor, toDecimalString, type DecimalString } from '@/lib/money';
import { DataError } from './errors';

export type SplitMode = 'equal' | 'amounts' | 'percent';

/** One row of a split. `personId` null is you. */
export interface ShareDraft {
  personId: string | null;
  amount: DecimalString;
  /** Percent mode only. */
  percent?: DecimalString | null;
  /** "Treat": they owe nothing for this share; it counts as your spending. */
  treat?: boolean;
}

export interface SplitDraft {
  mode: SplitMode;
  shares: ShareDraft[];
}

/**
 * Equal shares that add up exactly: each gets the total ÷ n rounded down to
 * the currency's minor units, and the leftover cents go one each to the first
 * rows (you are listed first).
 */
export function equalShares(total: DecimalString, count: number, currency: string): DecimalString[] {
  if (count <= 0) return [];
  const unit = new Decimal(1).dividedBy(new Decimal(10).pow(minorUnits(currency)));
  const each = dec(total).dividedBy(count).dividedToIntegerBy(unit).times(unit);
  let left = dec(total).minus(each.times(count));
  return Array.from({ length: count }, () => {
    if (left.gte(unit)) {
      left = left.minus(unit);
      return toDecimalString(each.plus(unit));
    }
    return toDecimalString(each);
  });
}

/**
 * Percent shares as amounts: each rounded to minor units, with the last row
 * taking whatever makes the total exact.
 */
export function percentShares(total: DecimalString, percents: DecimalString[], currency: string): DecimalString[] {
  const amounts = percents.map((p) => roundToMinor(dec(total).times(dec(p)).dividedBy(100), currency));
  if (amounts.length && percents.reduce((s, p) => s.plus(dec(p)), new Decimal(0)).eq(100)) {
    const others = amounts.slice(0, -1).reduce((s, a) => s.plus(dec(a)), new Decimal(0));
    amounts[amounts.length - 1] = toDecimalString(dec(total).minus(others));
  }
  return amounts;
}

/** "Remaining to assign": what the shares still need to reach the total (0 when it adds up). */
export function remainingToAssign(total: DecimalString, shares: Pick<ShareDraft, 'amount'>[]): DecimalString {
  return toDecimalString(shares.reduce((left, s) => left.minus(dec(s.amount || '0')), dec(total)));
}

/** "Remaining to assign" in percent mode: what's left of 100%. */
export function remainingPercent(shares: Pick<ShareDraft, 'percent'>[]): DecimalString {
  return toDecimalString(shares.reduce((left, s) => left.minus(dec(s.percent || '0')), new Decimal(100)));
}

/** Checks a split against the total it divides (Spec §9c). Throws DataError when it doesn't add up. */
export function checkSplit(split: SplitDraft, total: DecimalString, payerId: string | null): void {
  const yours = split.shares.filter((s) => s.personId === null);
  if (yours.length !== 1) throw new DataError('invalid_split', 'A split has one row for you');
  const people = split.shares.filter((s) => s.personId !== null).map((s) => s.personId);
  if (people.length === 0) throw new DataError('invalid_split', 'Add someone to split with');
  if (new Set(people).size !== people.length) throw new DataError('invalid_split', 'Someone is in the split twice');
  if (payerId && !people.includes(payerId)) throw new DataError('invalid_split', 'The person who paid is part of the split');
  for (const s of split.shares) {
    if (!/^\d+(\.\d+)?$/.test(s.amount)) throw new DataError('invalid_split', 'Each share needs an amount');
  }
  if (split.mode === 'percent' && !dec(remainingPercent(split.shares)).isZero()) {
    throw new DataError('invalid_split', 'The percentages need to reach 100%');
  }
  if (!dec(remainingToAssign(total, split.shares)).isZero()) {
    throw new DataError('invalid_split', 'The shares need to add up to the total');
  }
}

/** A saved split, back as a draft (for Edit). */
export function splitOf(db: AppDb, transactionId: string): SplitDraft | null {
  const rows = db.select().from(splitShares).where(eq(splitShares.transactionId, transactionId)).all();
  if (!rows.length) return null;
  // You first, then everyone else in the order they were added.
  const ordered = [...rows.filter((r) => r.personId === null), ...rows.filter((r) => r.personId !== null)];
  return {
    mode: rows[0].splitMode,
    shares: ordered.map((r) => ({ personId: r.personId, amount: r.shareAmount, percent: r.sharePercent, treat: r.isTreat })),
  };
}

/**
 * Saving with money left to assign (Owner, Nov 12): it isn't blocked; what's
 * left is added to your share. Works for amounts (whole = the total) and
 * percents (whole = 100). Null when the shares add up to more than the whole.
 */
export function leftoverToYou(values: DecimalString[], youIndex: number, whole: DecimalString): DecimalString[] | null {
  const left = values.reduce((rest, v) => rest.minus(dec(v || '0')), dec(whole));
  if (left.isNegative()) return null;
  if (left.isZero()) return values;
  return values.map((v, i) => (i === youIndex ? toDecimalString(dec(v || '0').plus(left)) : v));
}
