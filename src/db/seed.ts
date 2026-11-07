import { randomUUID } from 'expo-crypto';
import { count, eq, sql } from 'drizzle-orm';

import { ensureBaseData } from './base-data';

import type { AppDb } from './types';
import {
  accounts,
  categories,
  currencyOrder,
  goalAllocations,
  ledgers,
  people,
  savingsGoals,
  settings,
  transactions,
} from './schema';

/**
 * Development sample data, matching the design canvas (as of Sep 30, 2026).
 * Only runs in dev builds, and only on an empty database.
 *
 * Balances are carried by opening-balance rows for now; later build layers
 * add the September sample transactions and move these opening balances back
 * so the Sep 30 balances stay the same.
 */
export function seedSampleData(db: AppDb): boolean {
  const n = db.select({ n: count() }).from(accounts).get()?.n ?? 0;
  if (n > 0) return false;

  const OPENING_DATE = '2026-09-01';

  db.transaction((tx) => {
    tx
      .update(settings)
      .set({ defaultCurrency: 'USD', onboardingCompletedAt: new Date().toISOString() })
      .where(eq(settings.id, 1)).run();

    const personal = randomUUID();
    tx.insert(ledgers).values([
      { id: personal, name: 'Personal', icon: 'ledger', color: 'teal', isDefault: true, rank: 0 },
      { id: randomUUID(), name: 'Business', icon: 'ledger', color: 'neutral', rank: 1 },
    ]).run();

    const sample = [
      { name: 'Payoneer USD', currency: 'USD', institution: 'Payoneer', icon: 'wallet', color: 'orange', balance: '1250.00' },
      { name: 'Payoneer EUR', currency: 'EUR', institution: 'Payoneer', icon: 'wallet', color: 'orange', balance: '340.00' },
      { name: 'Alfalah PKR', currency: 'PKR', institution: null, icon: 'bank', color: 'teal', balance: '104231.75' },
      { name: 'Cash PKR', currency: 'PKR', institution: null, icon: 'cash', color: 'gold', balance: '2500.00' },
      { name: 'Cash AED', currency: 'AED', institution: null, icon: 'cash', color: 'gold', balance: '1200.00' },
      { name: 'Cash SAR', currency: 'SAR', institution: null, icon: 'cash', color: 'gold', balance: '450.00' },
    ];
    const accountIds = new Map<string, string>();
    for (const [rank, a] of sample.entries()) {
      const id = randomUUID();
      accountIds.set(a.name, id);
      tx.insert(accounts).values({
        id,
        name: a.name,
        currency: a.currency,
        institution: a.institution,
        icon: a.icon,
        color: a.color,
        rank,
      }).run();
      tx.insert(transactions).values({
        id: randomUUID(),
        kind: 'opening_balance',
        date: OPENING_DATE,
        status: 'cleared',
        accountId: id,
        amount: a.balance,
        currency: a.currency,
        accountAmount: a.balance,
      }).run();
    }

    tx.insert(currencyOrder).values(
      ['USD', 'PKR', 'EUR', 'AED', 'SAR'].map((currency, rank) => ({ currency, rank })),
    ).run();

    const expense = [
      { name: 'Client software', icon: 'monitor', color: 'blue' },
      { name: 'Groceries', icon: 'basket', color: 'orange' },
      { name: 'Health', icon: 'heart', color: 'pink' },
      { name: 'Office & Utilities', icon: 'bolt', color: 'cyan' },
      { name: 'Software & Subscriptions', icon: 'bank', color: 'purple' },
      { name: 'Travel', icon: 'suitcase', color: 'orange' },
    ];
    tx
      .insert(categories)
      .values(expense.map((c, rank) => ({ id: randomUUID(), kind: 'expense' as const, rank, ...c }))).run();

    const consulting = randomUUID();
    tx.insert(categories).values([
      { id: consulting, name: 'Consulting income', kind: 'income', icon: 'bolt', color: 'cyan', rank: 0 },
      { id: randomUUID(), name: 'Retainer', kind: 'income', icon: 'bolt', color: 'cyan', parentId: consulting, rank: 0 },
      { id: randomUUID(), name: 'One-off projects', kind: 'income', icon: 'bolt', color: 'cyan', parentId: consulting, rank: 1 },
      { id: randomUUID(), name: 'Referral bonus', kind: 'income', icon: 'wallet', color: 'gold', rank: 1 },
      { id: randomUUID(), name: 'Other income', kind: 'income', icon: 'circle', color: 'neutral', rank: 2 },
    ]).run();

    tx
      .insert(people)
      .values(['John', 'Beta Client', 'Sana', 'Acme Corp'].map((name) => ({ id: randomUUID(), name }))).run();

    const emergency = randomUUID();
    tx.insert(savingsGoals).values([
      { id: emergency, name: 'Emergency fund', currency: 'USD', targetAmount: '2000.00', priority: 1 },
      { id: randomUUID(), name: 'New laptop', currency: 'USD', targetAmount: '1250.00', priority: 2 },
    ]).run();
    tx.insert(goalAllocations).values({
      id: randomUUID(),
      goalId: emergency,
      accountId: accountIds.get('Payoneer USD')!,
      kind: 'add',
      amount: '400.00',
      date: OPENING_DATE,
    }).run();
  });

  return true;
}

/**
 * Development only: wipes every table and loads the sample data again, so a
 * dev build can go back to the state the canvas shows.
 */
export function resetSampleData(db: AppDb): void {
  const tables = db
    .all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'`)
    .map((t) => t.name);
  db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    db.transaction((tx) => {
      for (const name of tables) tx.run(sql.raw(`delete from "${name}"`));
    });
  } finally {
    db.run(sql`PRAGMA foreign_keys = ON`);
  }
  ensureBaseData(db);
  seedSampleData(db);
}
