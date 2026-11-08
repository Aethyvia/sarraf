import { eq } from 'drizzle-orm';

import { budgets, settings } from '@/db/schema';
import { setup } from '@/test/factories';
import { createBudget } from '../budgets';
import { budgetAlertsDue, markBudgetAlerted } from '../reminders';

const sendAll = (db: Parameters<typeof budgetAlertsDue>[0], asOf: string) => {
  const due = budgetAlertsDue(db, asOf);
  for (const a of due) markBudgetAlerted(db, a.budgetId, a.mark);
  return due;
};

describe('budget alerts', () => {
  it('sends 80% once, then 100% once, per period', async () => {
    const t = await setup();
    const acc = t.account('Payoneer USD', 'USD');
    const food = t.category('Food');
    createBudget(t.db, { ledgerId: t.personal, categoryId: food, currency: 'USD', amount: '100' });
    t.tx({ kind: 'expense', ledgerId: t.personal, accountId: acc, amount: '79', accountAmount: '79', currency: 'USD', categoryId: food, date: '2026-09-05' });
    expect(sendAll(t.db, '2026-09-10')).toHaveLength(0);

    t.tx({ kind: 'expense', ledgerId: t.personal, accountId: acc, amount: '1', accountAmount: '1', currency: 'USD', categoryId: food, date: '2026-09-06' });
    const first = sendAll(t.db, '2026-09-10');
    expect(first.map((a) => a.title)).toEqual(['Food: 80% of budget used']);
    expect(first[0].body).toBe('$80.00 of $100.00 · $20.00 left · Personal');
    expect(sendAll(t.db, '2026-09-11')).toHaveLength(0);

    t.tx({ kind: 'expense', ledgerId: t.personal, accountId: acc, amount: '30', accountAmount: '30', currency: 'USD', categoryId: food, date: '2026-09-07' });
    const second = sendAll(t.db, '2026-09-12');
    expect(second.map((a) => a.title)).toEqual(['Food: budget used up']);
    expect(second[0].body).toBe('$110.00 of $100.00 · $10.00 over · Personal');
    expect(sendAll(t.db, '2026-09-13')).toHaveLength(0);

    // A new month starts fresh.
    t.tx({ kind: 'expense', ledgerId: t.personal, accountId: acc, amount: '85', accountAmount: '85', currency: 'USD', categoryId: food, date: '2026-10-02' });
    expect(sendAll(t.db, '2026-10-03').map((a) => a.mark)).toEqual(['2026-10-01:80']);
  });

  it('jumping past 100% sends only the 100% alert', async () => {
    const t = await setup();
    const acc = t.account('Payoneer USD', 'USD');
    createBudget(t.db, { ledgerId: t.personal, categoryId: null, currency: 'USD', amount: '50' });
    t.tx({ kind: 'expense', ledgerId: t.personal, accountId: acc, amount: '60', accountAmount: '60', currency: 'USD', date: '2026-09-05' });
    const due = sendAll(t.db, '2026-09-05');
    expect(due.map((a) => a.title)).toEqual(['All spending: budget used up']);
    expect(sendAll(t.db, '2026-09-06')).toHaveLength(0);
  });

  it('respects the switches and Hide amounts', async () => {
    const t = await setup();
    const acc = t.account('Payoneer USD', 'USD');
    const id = createBudget(t.db, { ledgerId: t.personal, categoryId: null, currency: 'USD', amount: '50' });
    t.tx({ kind: 'expense', ledgerId: t.personal, accountId: acc, amount: '60', accountAmount: '60', currency: 'USD', date: '2026-09-05' });

    // 100% off in Settings: the 80% alert still goes out.
    t.db.update(settings).set({ notifyBudget100: false, hideAmounts: true }).where(eq(settings.id, 1)).run();
    const due = budgetAlertsDue(t.db, '2026-09-05');
    expect(due.map((a) => a.mark)).toEqual(['2026-09-01:80']);
    expect(due[0].body).toBe('Personal ledger · tap to see your budgets');

    // Off on the budget itself: nothing.
    t.db.update(budgets).set({ notify80: false }).where(eq(budgets.id, id)).run();
    expect(budgetAlertsDue(t.db, '2026-09-05')).toHaveLength(0);
  });
});
