import { ensureBaseData } from '@/db/base-data';
import { accounts, currencyOrder, ledgers, settings } from '@/db/schema';
import { createTestDb } from '@/test/db';
import { LimitReachedError } from '../limits';
import { finishSetup, suggestedAccounts } from '../setup';

describe('first-run setup', () => {
  it('suggests the board’s accounts for PKR + USD, EUR, AED', () => {
    const s = suggestedAccounts('PKR', ['USD', 'EUR', 'AED']);
    expect(s.map((a) => [a.name, a.ticked])).toEqual([
      ['Payoneer USD', true],
      ['Payoneer EUR', true],
      ['Bank PKR', true],
      ['Cash PKR', true],
      ['Cash AED', false],
    ]);
    expect(s.find((a) => a.name === 'Bank PKR')).toMatchObject({ renameHint: true, icon: 'bank' });
    expect(s.find((a) => a.name === 'Payoneer USD')).toMatchObject({ institution: 'Payoneer', icon: 'wallet' });
  });

  it('never ticks more than Free covers', () => {
    const s = suggestedAccounts('PKR', ['USD', 'EUR', 'GBP', 'AED', 'SAR']);
    expect(s.filter((a) => a.ticked)).toHaveLength(5);
  });

  it('creates the Personal ledger, the accounts and the currency order', async () => {
    const db = await createTestDb();
    ensureBaseData(db);
    const picked = suggestedAccounts('PKR', ['USD', 'EUR', 'AED']).filter((a) => a.ticked);
    finishSetup(db, { everyday: 'PKR', also: ['USD', 'EUR', 'AED'], accounts: picked }, 'free');
    expect(db.select().from(ledgers).all().map((l) => [l.name, l.isDefault])).toEqual([['Personal', true]]);
    expect(db.select().from(accounts).all().map((a) => a.name)).toEqual(['Payoneer USD', 'Payoneer EUR', 'Bank PKR', 'Cash PKR']);
    const s = db.select().from(settings).get()!;
    expect(s.defaultCurrency).toBe('PKR');
    expect(s.onboardingCompletedAt).not.toBeNull();
    expect(db.select().from(currencyOrder).all().sort((a, b) => a.rank - b.rank).map((c) => c.currency)).toEqual(['PKR', 'USD', 'EUR', 'AED']);
  });

  it('a sixth account on Free is refused and nothing is created', async () => {
    const db = await createTestDb();
    ensureBaseData(db);
    const six = suggestedAccounts('PKR', ['USD', 'EUR', 'GBP', 'AED']).map((a) => ({ ...a, ticked: true }));
    expect(six).toHaveLength(6);
    expect(() => finishSetup(db, { everyday: 'PKR', also: [], accounts: six }, 'free')).toThrow(LimitReachedError);
    expect(db.select().from(accounts).all()).toHaveLength(0);
    expect(db.select().from(settings).get()!.onboardingCompletedAt).toBeNull();
  });
});
