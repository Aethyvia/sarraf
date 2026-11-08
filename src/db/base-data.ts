import { eq } from 'drizzle-orm';
import { randomUUID } from 'expo-crypto';

import type { AppDb } from './types';
import { categories, deviceState, settings } from './schema';

/**
 * Rows every install needs, created once after migrations:
 * the settings row and the built-in Fees & charges category.
 * The default ledger and default currency are set by first run (setup step 1).
 */
export function ensureBaseData(db: AppDb): void {
  // Drizzle's SQLite transactions are synchronous: use .get()/.run(), never await, inside them.
  db.transaction((tx) => {
    if (!tx.select({ id: settings.id }).from(settings).where(eq(settings.id, 1)).get()) {
      tx.insert(settings).values({ id: 1, defaultCurrency: 'USD', deviceId: randomUUID() }).run();
    }
    if (!tx.select({ id: deviceState.id }).from(deviceState).where(eq(deviceState.id, 1)).get()) {
      tx.insert(deviceState).values({ id: 1 }).run();
    }
    if (!tx.select({ id: categories.id }).from(categories).where(eq(categories.isSystem, true)).get()) {
      tx.insert(categories)
        .values({
          id: randomUUID(),
          name: 'Fees & charges',
          kind: 'expense',
          icon: 'dollar',
          color: 'neutral',
          isSystem: true,
        })
        .run();
    }
  });
}
