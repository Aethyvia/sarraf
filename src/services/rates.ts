import { db } from '@/db/client';
import { RATE_BASE, ratesAreStale, ratesFetchedAt, storeRates } from '@/data/rates';

/**
 * Market rates come through Sarraf's Supabase (owner, Nov 15): Supabase fetches the day's
 * mid-market rates from ExchangeRate-API once a day (supabase/migrations/0004_market_rates.sql),
 * and phones read them from there with the public key, signed in or not. Nothing about
 * anyone's money is sent: the request only names the base currency.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';
/** The provider asks for a credit wherever its rates are shown (shown in Settings → About). */
export const RATES_ATTRIBUTION = 'Rates by ExchangeRate-API';
export const RATES_ATTRIBUTION_URL = 'https://www.exchangerate-api.com';

let inFlight: Promise<boolean> | null = null;

/** Refreshes rates when they're older than 6 hours. Returns true when fresh rates were stored. Never throws. */
export function refreshRatesIfStale(force = false): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return Promise.resolve(false);
  if (!force && !ratesAreStale(ratesFetchedAt(db))) return Promise.resolve(false);
  inFlight ??= (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/market_rates?base=eq.${RATE_BASE}&select=rates,fetched_at`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      if (!res.ok) return false;
      const rows = (await res.json()) as { rates?: Record<string, number>; fetched_at?: string }[];
      const row = rows[0];
      if (!row?.rates) return false;
      // Quotes arrive as JSON numbers; keep their decimal text exactly as sent.
      const quotes = Object.fromEntries(Object.entries(row.rates).map(([k, v]) => [k, String(v)]));
      return storeRates(db, quotes, row.fetched_at ? new Date(row.fetched_at).toISOString() : undefined) > 0;
    } catch {
      return false; // Offline: the last rates stay, labelled with their date.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
