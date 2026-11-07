import { eq, min } from 'drizzle-orm';

import { marketRates } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso } from '@/lib/dates';
import { Decimal, dec, isDecimalString, toDecimalString, type DecimalString } from '@/lib/money';

/**
 * Current market rates only (Decided): for "≈" estimates, "Market rate · tap
 * to use", and the market rate saved on each cross-currency transaction. Stored
 * as quotes against one base currency; any pair is worked out from two quotes.
 */
export const RATE_BASE = 'USD';
/** Rates are refreshed on app open when older than this (Decided Nov 7). */
export const RATES_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Decimal places kept on a cross rate worked out from two quotes. */
export const CROSS_RATE_PLACES = 10;

export interface MarketRate {
  /** 1 unit of `from` = rate units of `to`. */
  rate: DecimalString;
  fetchedAt: string;
}

/** Replaces the stored rates with a fresh set of quotes (1 base = quote units). */
export function storeRates(db: AppDb, quotes: Record<string, string | number>, fetchedAt: string = nowIso()): number {
  const rows = Object.entries(quotes)
    .map(([quote, value]) => [quote, String(value)] as const)
    .filter(([quote, value]) => /^[A-Z]{3}$/.test(quote) && isDecimalString(value) && dec(value).gt(0));
  db.transaction((tx) => {
    tx.delete(marketRates).run();
    for (const [quote, rate] of rows) {
      tx.insert(marketRates).values({ base: RATE_BASE, quote, rate, fetchedAt }).run();
    }
  });
  return rows.length;
}

function quote(db: AppDb, currency: string): { rate: string; fetchedAt: string } | null {
  if (currency === RATE_BASE) {
    const any = db.select({ fetchedAt: marketRates.fetchedAt }).from(marketRates).get();
    return any ? { rate: '1', fetchedAt: any.fetchedAt } : null;
  }
  return db.select({ rate: marketRates.rate, fetchedAt: marketRates.fetchedAt }).from(marketRates).where(eq(marketRates.quote, currency)).get() ?? null;
}

/** The market rate from one currency to another, or null when it isn't known. */
export function marketRate(db: AppDb, from: string, to: string): MarketRate | null {
  if (from === to) return null;
  const a = quote(db, from);
  const b = quote(db, to);
  if (!a || !b) return null;
  const rate = dec(b.rate).dividedBy(dec(a.rate)).toDecimalPlaces(CROSS_RATE_PLACES, Decimal.ROUND_HALF_EVEN);
  return { rate: toDecimalString(rate), fetchedAt: a.fetchedAt < b.fetchedAt ? a.fetchedAt : b.fetchedAt };
}

/** When the stored rates were fetched (the oldest), or null when there are none. */
export function ratesFetchedAt(db: AppDb): string | null {
  return db.select({ at: min(marketRates.fetchedAt) }).from(marketRates).get()?.at ?? null;
}

export function ratesAreStale(fetchedAt: string | null, now: Date = new Date()): boolean {
  return fetchedAt === null || now.getTime() - new Date(fetchedAt).getTime() > RATES_MAX_AGE_MS;
}
