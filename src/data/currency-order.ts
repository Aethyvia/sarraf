import { eq } from 'drizzle-orm';

import { currencyOrder } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso } from '@/lib/dates';

/** Moves a currency to a 0-based position in Home's tile order; the others keep their order. */
export function moveCurrency(db: AppDb, ordered: string[], currency: string, position: number): string[] {
  const rest = ordered.filter((c) => c !== currency);
  const next = [...rest.slice(0, position), currency, ...rest.slice(position)];
  db.transaction((tx) => {
    next.forEach((c, rank) => {
      const exists = tx.select().from(currencyOrder).where(eq(currencyOrder.currency, c)).get();
      if (exists) tx.update(currencyOrder).set({ rank, updatedAt: nowIso() }).where(eq(currencyOrder.currency, c)).run();
      else tx.insert(currencyOrder).values({ currency: c, rank }).run();
    });
  });
  return next;
}

/** Sorts currency codes into Home's tile order (unranked ones last, A → Z). */
export function sortByCurrencyOrder<T>(db: AppDb, items: T[], code: (item: T) => string): T[] {
  const rank = new Map(db.select().from(currencyOrder).all().map((r) => [r.currency, r.rank]));
  return [...items].sort((a, b) => (rank.get(code(a)) ?? 999) - (rank.get(code(b)) ?? 999) || code(a).localeCompare(code(b)));
}
