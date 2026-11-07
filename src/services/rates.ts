import { db } from '@/db/client';
import { RATE_BASE, ratesAreStale, ratesFetchedAt, storeRates } from '@/data/rates';

/**
 * Market rates come from ExchangeRate-API's open endpoint (no key; daily
 * mid-market rates; covers PKR, AED, SAR). The provider is the developer's
 * choice (Spec §20). Only currency codes are sent — never any money data.
 */
const URL = `https://open.er-api.com/v6/latest/${RATE_BASE}`;
export const RATES_ATTRIBUTION = 'Rates by ExchangeRate-API';

let inFlight: Promise<boolean> | null = null;

/** Refreshes rates when they're older than 6 hours. Returns true when fresh rates were stored. Never throws. */
export function refreshRatesIfStale(force = false): Promise<boolean> {
  if (!force && !ratesAreStale(ratesFetchedAt(db))) return Promise.resolve(false);
  inFlight ??= (async () => {
    try {
      const res = await fetch(URL);
      if (!res.ok) return false;
      const body = (await res.json()) as { result?: string; rates?: Record<string, number> };
      if (body.result !== 'success' || !body.rates) return false;
      // Quotes arrive as JSON numbers; keep their decimal text exactly as sent.
      const quotes = Object.fromEntries(Object.entries(body.rates).map(([k, v]) => [k, String(v)]));
      return storeRates(db, quotes) > 0;
    } catch {
      return false; // Offline: the last rates stay, labelled with their date.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
