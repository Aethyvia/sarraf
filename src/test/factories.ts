import { randomUUID } from 'crypto';

import { ensureBaseData } from '@/db/base-data';
import { transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { createAccount } from '@/data/accounts';
import { createCategory } from '@/data/categories';
import { createLedger } from '@/data/ledgers';
import { createPerson } from '@/data/people';
import { createTestDb } from './db';

/** A test database with base data, one default ledger, and the helpers tests reach for. */
export async function setup() {
  const db = await createTestDb();
  ensureBaseData(db);
  const personal = createLedger(db, { name: 'Personal' }, 'free');
  return {
    db,
    personal,
    account: (name: string, currency: string, currentBalance?: string) =>
      createAccount(db, { name, currency, currentBalance }, 'plus'),
    category: (name: string, kind: 'expense' | 'income' = 'expense', parentId?: string) =>
      createCategory(db, { name, kind, parentId, icon: 'circle', color: 'neutral' }),
    person: (name: string) => createPerson(db, { name }),
    tx: (values: Partial<typeof transactions.$inferInsert>) => insertTransaction(db, values),
  };
}

export function insertTransaction(db: AppDb, values: Partial<typeof transactions.$inferInsert>): string {
  const id = values.id ?? randomUUID();
  db.insert(transactions)
    .values({
      kind: 'expense',
      date: '2026-09-15',
      status: 'cleared',
      amount: '10',
      currency: 'USD',
      ...values,
      id,
    })
    .run();
  return id;
}
