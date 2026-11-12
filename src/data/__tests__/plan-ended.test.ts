import { eq } from 'drizzle-orm';

import { accounts, goalAllocations, ledgers, savingsGoals } from '@/db/schema';
import { setup } from '@/test/factories';
import { addToGoal, createGoal, goalTotal, unarchiveGoal } from '../goals';
import { createLedger } from '../ledgers';
import { usage } from '../limits';
import { applyPlanChoice, needsPlanChoice, overLimit, suggestedKeep } from '../plan-ended';

async function world() {
  const s = await setup();
  const accs = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => s.account(`Cash ${n}`, 'USD', '100'));
  const business = createLedger(s.db, { name: 'Business' }, 'plus');
  const side = createLedger(s.db, { name: 'Side' }, 'plus');
  const goals = ['G1', 'G2', 'G3', 'G4'].map((n) => createGoal(s.db, { name: n, currency: 'USD', target: '500' }, 'plus'));
  return { ...s, accs, business, side, goals };
}

describe('when Sarraf Plus ends (Owner, Nov 12)', () => {
  it('knows what is over the free limits, and nothing is over on Plus', async () => {
    const w = await world();
    expect(overLimit(w.db, 'free')).toEqual({ accounts: 2, ledgers: 1, goals: 1 });
    expect(needsPlanChoice(w.db, 'free')).toBe(true);
    expect(needsPlanChoice(w.db, 'plus')).toBe(false);
  });

  it('archives everything not kept, all at once; archive rules apply and nothing is deleted', async () => {
    const w = await world();
    addToGoal(w.db, { goalId: w.goals[3], accountId: w.accs[0], amount: '40' });
    const keep = suggestedKeep(w.db);
    expect(keep.accounts).toHaveLength(5);
    expect(keep.ledgers[0]).toBe(w.personal);
    const res = applyPlanChoice(w.db, { ...keep, goals: w.goals.slice(0, 3) });
    expect(res.archived).toEqual({ accounts: 2, ledgers: 1, goals: 1 });
    expect(needsPlanChoice(w.db, 'free')).toBe(false);
    expect(usage(w.db, 'accounts')).toBe(5);
    expect(w.db.select().from(accounts).all()).toHaveLength(7);
    // The archived goal's money went back to Usable; its history stays.
    expect(goalTotal(w.db, w.goals[3])).toBe('0');
    expect(w.db.select().from(goalAllocations).where(eq(goalAllocations.goalId, w.goals[3])).all()).toHaveLength(2);
  });

  it('refuses keeping more than the limit, or dropping the default ledger', async () => {
    const w = await world();
    const keep = suggestedKeep(w.db);
    expect(() => applyPlanChoice(w.db, { ...keep, accounts: w.accs.slice(0, 6) })).toThrow(expect.objectContaining({ code: 'limit_reached' }));
    expect(() => applyPlanChoice(w.db, { ...keep, ledgers: [w.business, w.side] })).toThrow(expect.objectContaining({ code: 'default_ledger' }));
    // Nothing changed.
    expect(w.db.select().from(ledgers).where(eq(ledgers.id, w.side)).get()?.archivedAt).toBeNull();
  });

  it('an archived goal can come back, counting like adding one', async () => {
    const w = await world();
    applyPlanChoice(w.db, { ...suggestedKeep(w.db), goals: w.goals.slice(0, 3) });
    expect(() => unarchiveGoal(w.db, w.goals[3], 'free')).toThrow(expect.objectContaining({ code: 'limit_reached' }));
    unarchiveGoal(w.db, w.goals[3], 'plus');
    expect(w.db.select().from(savingsGoals).where(eq(savingsGoals.id, w.goals[3])).get()?.archivedAt).toBeNull();
  });
});
