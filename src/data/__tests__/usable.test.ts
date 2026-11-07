import { goalAllocations, savingsGoals } from '@/db/schema';
import { archiveAccount } from '../accounts';
import { addToGoal, goalTotal, stillToGo } from '../goals';
import { saveTransaction } from '../transactions';
import { accountFree, currencyPositions, spendWarning, upcomingOnAccount } from '../usable';
import { setup } from '@/test/factories';

const TODAY = '2026-09-30';
jest.useFakeTimers().setSystemTime(new Date('2026-09-01T12:00:00'));

async function world() {
  const s = await setup();
  const usd = s.account('Payoneer USD', 'USD', '1250');
  const wise = s.account('Wise USD', 'USD', '100');
  const pkr = s.account('Alfalah PKR', 'PKR', '104231.75');
  s.db.insert(savingsGoals)
    .values([
      { id: 'emergency', name: 'Emergency fund', currency: 'USD', targetAmount: '2000', priority: 1 },
      { id: 'laptop', name: 'New laptop', currency: 'USD', targetAmount: '1250', priority: 2 },
    ])
    .run();
  return { ...s, usd, wise, pkr };
}

describe('Usable per currency', () => {
  it('is the currency balance minus money set aside in that currency’s goals', async () => {
    const w = await world();
    addToGoal(w.db, { goalId: 'emergency', accountId: w.usd, amount: '400', date: '2026-09-01' });
    const usd = currencyPositions(w.db, TODAY).get('USD')!;
    expect(usd).toEqual({ currency: 'USD', balance: '1350', setAside: '400', usable: '950' });
    expect(currencyPositions(w.db, TODAY).get('PKR')!.usable).toBe('104231.75');
  });

  it('may go negative', async () => {
    const w = await world();
    addToGoal(w.db, { goalId: 'laptop', accountId: w.usd, amount: '1500' });
    expect(currencyPositions(w.db, TODAY).get('USD')!.usable).toBe('-150');
  });

  it('leaves out archived accounts (their set-aside money is released)', async () => {
    const w = await world();
    addToGoal(w.db, { goalId: 'emergency', accountId: w.wise, amount: '50' });
    archiveAccount(w.db, w.wise);
    expect(currencyPositions(w.db, TODAY).get('USD')).toMatchObject({ balance: '1250', setAside: '0', usable: '1250' });
  });
});

describe('Add — Savings', () => {
  it('sets money aside from an account of the goal’s currency; no transaction', async () => {
    const w = await world();
    addToGoal(w.db, { goalId: 'emergency', accountId: w.usd, amount: '400' });
    addToGoal(w.db, { goalId: 'emergency', accountId: w.usd, amount: '150.00' });
    expect(goalTotal(w.db, 'emergency')).toBe('550');
    expect(stillToGo('2000', '400', '150')).toBe('1450');
    expect(stillToGo('100', '90', '50')).toBe('0');
    expect(accountFree(w.db, w.usd, TODAY)).toEqual({ balance: '1250', setAside: '550', free: '700' });
  });

  it('refuses another currency and a zero amount', async () => {
    const w = await world();
    expect(() => addToGoal(w.db, { goalId: 'emergency', accountId: w.pkr, amount: '1' })).toThrow(/currency/);
    expect(() => addToGoal(w.db, { goalId: 'emergency', accountId: w.usd, amount: '0' })).toThrow(/above zero/);
    expect(w.db.select().from(goalAllocations).all()).toHaveLength(0);
  });
});

describe('spending warnings', () => {
  it('none when the amount fits in Usable', async () => {
    const w = await world();
    addToGoal(w.db, { goalId: 'emergency', accountId: w.usd, amount: '400' });
    expect(spendWarning(w.db, w.usd, '900', TODAY)).toEqual({ level: 'none' });
  });

  it('amber when it dips into savings: the lowest-priority goal gives up first', async () => {
    const w = await world();
    addToGoal(w.db, { goalId: 'emergency', accountId: w.usd, amount: '400' });
    addToGoal(w.db, { goalId: 'laptop', accountId: w.usd, amount: '300' });
    // USD: balance 1,350, set aside 700, Usable 650. Spending 900 uses 250 of savings.
    expect(spendWarning(w.db, w.usd, '900', TODAY)).toEqual({
      level: 'savings',
      usesSavings: '250',
      usable: '650',
      setAside: '700',
      firstGoal: { name: 'New laptop', amount: '250' },
    });
  });

  it('red when it is more than the account has', async () => {
    const w = await world();
    addToGoal(w.db, { goalId: 'emergency', accountId: w.usd, amount: '400' });
    expect(spendWarning(w.db, w.usd, '1300', TODAY)).toEqual({ level: 'balance', overBy: '50', after: '-50', setAsideUsedUp: '400' });
  });
});

describe('upcoming on an account', () => {
  it('counts scheduled items and their total effect', async () => {
    const w = await world();
    const save = (date: string, amount: string) =>
      saveTransaction(w.db, { kind: 'expense', accountId: w.pkr, amount, currency: 'PKR', date, status: 'cleared' }, { today: TODAY });
    save('2026-10-26', '12500');
    save('2026-10-30', '6000');
    save('2026-09-15', '1');
    expect(upcomingOnAccount(w.db, w.pkr)).toEqual({ count: 2, total: '-18500', lastDate: '2026-10-30' });
  });
});
