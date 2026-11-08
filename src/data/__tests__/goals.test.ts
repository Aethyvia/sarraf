import { eq } from 'drizzle-orm';

import { savingsGoals } from '@/db/schema';
import { addToGoal, completeGoal, createGoal, goalByAccount, goalHistory, goalTotal, shrinkGoalsToFit, takeOutOfGoal } from '../goals';
import { LimitReachedError } from '../limits';
import { saveTransaction, type TransactionDraft } from '../transactions';
import { currencyPositions } from '../usable';
import { setup } from '@/test/factories';

const TODAY = '2026-09-30';

async function world() {
  const s = await setup();
  const usd = s.account('Payoneer USD', 'USD');
  const wise = s.account('Wise USD', 'USD');
  s.tx({ kind: 'opening_balance', accountId: usd, amount: '1000', accountAmount: '1000', date: '2026-09-01' });
  s.tx({ kind: 'opening_balance', accountId: wise, amount: '200', accountAmount: '200', date: '2026-09-01' });
  const usable = () => currencyPositions(s.db, TODAY).get('USD')!.usable;
  const spend = (accountId: string, amount: string) =>
    saveTransaction(s.db, { kind: 'expense', date: '2026-09-20', status: 'cleared', accountId, amount, currency: 'USD' } as TransactionDraft, { today: TODAY });
  return { ...s, usd, wise, usable, spend };
}

describe('savings goals', () => {
  it('set aside from accounts, shown by account; no money moves, only Usable drops', async () => {
    const w = await world();
    const trip = createGoal(w.db, { name: 'Family trip', currency: 'USD', target: '1000' }, 'free');
    addToGoal(w.db, { goalId: trip, accountId: w.usd, amount: '400', date: '2026-09-02' });
    addToGoal(w.db, { goalId: trip, accountId: w.wise, amount: '50', date: '2026-09-03' });
    expect(goalByAccount(w.db, trip)).toEqual([
      { accountId: w.usd, amount: '400' },
      { accountId: w.wise, amount: '50' },
    ]);
    expect(w.usable()).toBe('750');
  });

  it('take money out (part or all), most recently added first; Mark as complete releases the rest', async () => {
    const w = await world();
    const trip = createGoal(w.db, { name: 'Trip', currency: 'USD', target: '1000' }, 'free');
    addToGoal(w.db, { goalId: trip, accountId: w.usd, amount: '400' });
    addToGoal(w.db, { goalId: trip, accountId: w.wise, amount: '50' });
    takeOutOfGoal(w.db, { goalId: trip, amount: '70', notes: 'Visa fee' });
    expect(goalByAccount(w.db, trip)).toEqual([{ accountId: w.usd, amount: '380' }]);
    expect(() => takeOutOfGoal(w.db, { goalId: trip, amount: '381' })).toThrow(expect.objectContaining({ code: 'invalid_amount' }));
    completeGoal(w.db, trip, TODAY);
    expect(goalTotal(w.db, trip)).toBe('0');
    expect(w.usable()).toBe('1200');
    expect(goalHistory(w.db, trip).map((h) => h.kind)).toContain('release');
  });

  it('overspending shrinks the lowest-priority goal first', async () => {
    const w = await world();
    const emergency = createGoal(w.db, { name: 'Emergency', currency: 'USD', target: '2000' }, 'free');
    const laptop = createGoal(w.db, { name: 'Laptop', currency: 'USD', target: '1250' }, 'free');
    addToGoal(w.db, { goalId: emergency, accountId: w.usd, amount: '400' });
    addToGoal(w.db, { goalId: laptop, accountId: w.usd, amount: '300' });
    // $1,000 − $500 = $500 left, but $700 is set aside: $200 must go, from the laptop (priority 2) first.
    w.spend(w.usd, '500');
    expect([goalTotal(w.db, emergency), goalTotal(w.db, laptop)]).toEqual(['400', '100']);
    // Another $300: laptop empties, then the emergency fund shrinks by the rest.
    w.spend(w.usd, '300');
    expect([goalTotal(w.db, emergency), goalTotal(w.db, laptop)]).toEqual(['200', '0']);
    expect(shrinkGoalsToFit(w.db, w.usd, TODAY)).toEqual([]);
  });

  it('free plan: 3 open goals; a completed one frees its slot', async () => {
    const w = await world();
    const ids = ['A', 'B', 'C'].map((name) => createGoal(w.db, { name, currency: 'USD', target: '10' }, 'free'));
    expect(() => createGoal(w.db, { name: 'D', currency: 'USD', target: '10' }, 'free')).toThrow(LimitReachedError);
    completeGoal(w.db, ids[0], TODAY);
    expect(() => createGoal(w.db, { name: 'D', currency: 'USD', target: '10' }, 'free')).not.toThrow();
    expect(w.db.select().from(savingsGoals).where(eq(savingsGoals.name, 'D')).get()?.priority).toBe(4);
  });
});
