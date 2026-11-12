import { isNotNull } from 'drizzle-orm';

import { ensureBaseData } from '@/db/base-data';
import { accounts, categories, currencyOrder, ledgers, settings } from '@/db/schema';
import { createTestDb } from '@/test/db';
import { addDefaultCategories, DEFAULT_CATEGORIES } from '../default-categories';
import { LimitReachedError } from '../limits';
import { finishSetup, suggestedAccounts } from '../setup';

describe('first-run setup', () => {
  it('suggests a Bank and a Cash account per chosen currency, no institution', () => {
    const s = suggestedAccounts('PKR', ['USD', 'AED']);
    expect(s.map((a) => [a.name, a.ticked])).toEqual([
      ['Bank PKR', true],
      ['Cash PKR', true],
      ['Bank USD', false],
      ['Cash USD', false],
      ['Bank AED', false],
      ['Cash AED', false],
    ]);
    expect(s.every((a) => a.institution === null)).toBe(true);
    expect(s.find((a) => a.name === 'Bank PKR')).toMatchObject({ renameHint: true, icon: 'bank' });
  });

  it('creates the Personal ledger, the accounts, the default categories and the currency order', async () => {
    const db = await createTestDb();
    ensureBaseData(db);
    const picked = suggestedAccounts('PKR', ['USD', 'AED']).map((a) => ({ ...a, ticked: a.currency !== 'AED' })).filter((a) => a.ticked);
    finishSetup(db, { everyday: 'PKR', also: ['USD', 'AED'], accounts: picked }, 'free');
    expect(db.select().from(ledgers).all().map((l) => [l.name, l.isDefault])).toEqual([['Personal', true]]);
    expect(db.select().from(accounts).all().map((a) => a.name)).toEqual(['Bank PKR', 'Cash PKR', 'Bank USD', 'Cash USD']);
    const s = db.select().from(settings).get()!;
    expect(s.defaultCurrency).toBe('PKR');
    expect(s.onboardingCompletedAt).not.toBeNull();
    expect(db.select().from(currencyOrder).all().sort((a, b) => a.rank - b.rank).map((c) => c.currency)).toEqual(['PKR', 'USD', 'AED']);
    const food = db.select().from(categories).all().find((c) => c.name === 'Food')!;
    const subs = db.select().from(categories).where(isNotNull(categories.parentId)).all().filter((c) => c.parentId === food.id).map((c) => c.name);
    expect(subs).toEqual(expect.arrayContaining(['Vegetables', 'Fruits', 'Fast food']));
  });

  it('default categories are added once, and not over the user’s own', async () => {
    const db = await createTestDb();
    ensureBaseData(db);
    const n = DEFAULT_CATEGORIES.reduce((t, c) => t + 1 + (c.subs?.length ?? 0), 0);
    expect(addDefaultCategories(db)).toBe(n);
    expect(addDefaultCategories(db)).toBe(0);
  });

  it('a sixth account on Free is refused and nothing is created', async () => {
    const db = await createTestDb();
    ensureBaseData(db);
    const six = suggestedAccounts('PKR', ['USD', 'EUR']).map((a) => ({ ...a, ticked: true }));
    expect(six).toHaveLength(6);
    expect(() => finishSetup(db, { everyday: 'PKR', also: [], accounts: six }, 'free')).toThrow(LimitReachedError);
    expect(db.select().from(accounts).all()).toHaveLength(0);
    expect(db.select().from(settings).get()!.onboardingCompletedAt).toBeNull();
  });
});
