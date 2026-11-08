import { eq } from 'drizzle-orm';

import { ensureBaseData } from '@/db/base-data';
import { buildSampleData, SAMPLE_TODAY } from '@/db/sample';
import { categories, ledgers } from '@/db/schema';
import { createTestDb } from '@/test/db';
import { budgetStatuses, budgetWarning, overlapWarnings } from '../budgets';
import { flows, UNCATEGORIZED } from '../spending';
import { saveTransaction, type TransactionDraft } from '../transactions';
import { setup } from '@/test/factories';

async function sample() {
  const db = await createTestDb();
  ensureBaseData(db);
  buildSampleData(db);
  const ledger = (name: string) => db.select().from(ledgers).where(eq(ledgers.name, name)).get()!.id;
  const cat = (name: string) => db.select().from(categories).where(eq(categories.name, name)).get()!.id;
  return { db, ledger, cat };
}
const SEP = { from: '2026-09-01', to: SAMPLE_TODAY };

describe('spending and income (the sample, Spec §19)', () => {
  it('Personal USD: $173 spent, $450 earned; a fully reimbursed trip nets to zero', async () => {
    const { db, ledger, cat } = await sample();
    const f = flows(db, { ...SEP, currency: 'USD', ledgerId: ledger('Personal') });
    expect(f.totalSpending).toBe('173');
    expect(Object.fromEntries(f.spending.map((x) => [x.categoryId, x.amount]))).toEqual({
      [cat('Software & Subscriptions')]: '54',
      [cat('Groceries')]: '50',
      [cat('Travel')]: '35',
      [cat('Office & Utilities')]: '34',
    });
    expect(f.totalIncome).toBe('450');
    // Analytics: Consulting income $450 = Retainer $300 + One-off $100 + its own $50; by person Beta Client $300, Acme $50, no person $100.
    expect(f.income).toEqual([{ categoryId: cat('Consulting income'), amount: '450', count: 3 }]);
    expect(Object.fromEntries(f.incomeSubs.map((x) => [x.categoryId, x.amount]))).toEqual({ [cat('Retainer')]: '300', [cat('One-off projects')]: '100', [cat('Consulting income')]: '50' });
    expect(f.incomeByPerson.map((x) => x.amount)).toEqual(['300', '50', '100']);
    expect(f.incomeByPerson[2].personId).toBeNull();
  });

  it('Business USD: $840 spent, $1,200 earned', async () => {
    const { db, ledger } = await sample();
    const f = flows(db, { ...SEP, currency: 'USD', ledgerId: ledger('Business') });
    expect([f.totalSpending, f.totalIncome]).toEqual(['840', '1200']);
  });

  it('PKR across ledgers: Groceries ₨4,200 and your dinner share ₨521.17', async () => {
    const { db, cat } = await sample();
    const f = flows(db, { ...SEP, currency: 'PKR' });
    expect(f.spending.map((x) => [x.categoryId, x.amount])).toEqual([
      [cat('Groceries'), '4200'],
      [UNCATEGORIZED, '521.17'],
    ]);
  });
});

describe('budgets', () => {
  it('match the sample: All spending $173 of $180, Software $4 over, Groceries ₨1,100 over', async () => {
    const { db, ledger } = await sample();
    const byName = new Map(
      budgetStatuses(db, ledger('Personal'), SAMPLE_TODAY).map((b) => [`${b.budget.categoryId ? 'cat' : 'all'}:${b.budget.currency}:${b.budget.amount}`, b]),
    );
    expect(byName.get('all:USD:180')).toMatchObject({ spent: '173', left: '7', over: false, percent: 96 });
    expect(byName.get('cat:USD:50')).toMatchObject({ spent: '54', left: '-4', over: true });
    expect(byName.get('cat:PKR:3100')).toMatchObject({ spent: '4200', left: '-1100', over: true });
    // Heads-up: Software + Travel + Office = $190, $10 over the $180 cap.
    expect(overlapWarnings(db, ledger('Personal'))).toEqual([{ currency: 'USD', categories: '190', cap: '180', over: '10' }]);
  });

  it('the Add warning checks the category in the selected ledger only, and only when it goes or is over', async () => {
    const { db, ledger, cat } = await sample();
    const base = { categoryId: cat('Travel'), currency: 'USD', date: SAMPLE_TODAY };
    expect(budgetWarning(db, { ...base, ledgerId: ledger('Personal'), amount: '60' })).toBeNull();
    expect(budgetWarning(db, { ...base, ledgerId: ledger('Personal'), amount: '70' })).toMatchObject({ cap: '100', spent: '35', after: '105', alreadyOver: false });
    expect(budgetWarning(db, { ...base, ledgerId: ledger('Business'), amount: '500' })).toBeNull();
    expect(budgetWarning(db, { ...base, categoryId: cat('Software & Subscriptions'), ledgerId: ledger('Personal'), amount: '1' })).toMatchObject({ alreadyOver: true });
  });
});

describe('charges, splits and money back', () => {
  it('non-tax charges count under Fees & charges; tax charges count nowhere; a split counts my share plus treats', async () => {
    const s = await setup();
    const usd = s.account('Payoneer USD', 'USD');
    const food = s.category('Food');
    const john = s.person('John');
    const sana = s.person('Sana');
    const fees = s.db.select().from(categories).where(eq(categories.isSystem, true)).get()!.id;
    const save = (d: Partial<TransactionDraft>) =>
      saveTransaction(s.db, { kind: 'expense', date: '2026-09-10', status: 'cleared', currency: 'USD', accountId: usd, ...d } as TransactionDraft, { today: SAMPLE_TODAY });
    save({
      amount: '100',
      categoryId: food,
      charges: [
        { type: 'card_fx_fee', amount: '3', currency: 'USD', deduction: 'already_deducted' },
        { type: 'withholding_tax', amount: '2', currency: 'USD', deduction: 'already_deducted' },
      ],
    });
    save({
      amount: '90',
      categoryId: food,
      split: {
        mode: 'equal',
        shares: [
          { personId: null, amount: '30' },
          { personId: john, amount: '30' },
          { personId: sana, amount: '30', treat: true },
        ],
      },
    });
    const f = flows(s.db, { currency: 'USD', from: '2026-09-01', to: SAMPLE_TODAY });
    expect(Object.fromEntries(f.spending.map((x) => [x.categoryId, x.amount]))).toEqual({ [food]: '155', [fees]: '3' });
  });
});
