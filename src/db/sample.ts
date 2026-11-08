import { eq } from 'drizzle-orm';

import { createBudget } from '@/data/budgets';
import { addToGoal } from '@/data/goals';
import { createRecurring, type RecurringInput } from '@/data/recurring';
import { storeRates } from '@/data/rates';
import { saveTransaction, type TransactionDraft } from '@/data/transactions';
import { newId } from '@/lib/id';
import {
  accounts,
  categories,
  currencyOrder,
  ledgers,
  people,
  recurringItems,
  savingsGoals,
  settings,
  transactions,
} from './schema';
import type { AppDb } from './types';

/** The day the design canvas's sample data is "as of". */
export const SAMPLE_TODAY = '2026-09-30';

/**
 * The design canvas's sample data (Spec §19), as of Wednesday, Sep 30, 2026.
 * Opening balances are worked back from the Sep 30 balances so every screen
 * matches the canvas: Payoneer USD $1,250.00 · Payoneer EUR €340.00 ·
 * Alfalah PKR ₨1,04,231.75 · Cash PKR ₨2,500.00 · Cash AED 1,200.00 ·
 * Cash SAR 450.00; USD In $1,650 / Out $1,013; PKR Out ₨4,721.17; AED Out 310;
 * EUR In €340; John owes $250 and €40, you owe John ₨8,450.
 */
export function buildSampleData(db: AppDb): void {
  const id = () => newId();
  db.update(settings).set({ defaultCurrency: 'USD', onboardingCompletedAt: new Date().toISOString() }).where(eq(settings.id, 1)).run();

  const personal = id();
  const business = id();
  db.insert(ledgers)
    .values([
      { id: personal, name: 'Personal', icon: 'ledger', color: 'teal', isDefault: true, rank: 0 },
      { id: business, name: 'Business', icon: 'ledger', color: 'neutral', rank: 1 },
    ])
    .run();

  const acct: Record<string, string> = {};
  const accountRows = [
    { name: 'Payoneer USD', currency: 'USD', institution: 'Payoneer', icon: 'wallet', color: 'orange', opening: '1112.46' },
    { name: 'Payoneer EUR', currency: 'EUR', institution: 'Payoneer', icon: 'wallet', color: 'orange', opening: '40.00' },
    { name: 'Alfalah PKR', currency: 'PKR', institution: null, icon: 'bank', color: 'teal', opening: '45502.92' },
    { name: 'Cash PKR', currency: 'PKR', institution: null, icon: 'cash', color: 'gold', opening: '2500.00' },
    { name: 'Cash AED', currency: 'AED', institution: null, icon: 'cash', color: 'gold', opening: '1510.00' },
    { name: 'Cash SAR', currency: 'SAR', institution: null, icon: 'cash', color: 'gold', opening: '450.00' },
  ];
  accountRows.forEach((a, rank) => {
    acct[a.name] = id();
    db.insert(accounts).values({ id: acct[a.name], name: a.name, currency: a.currency, institution: a.institution, icon: a.icon, color: a.color, rank }).run();
    db.insert(transactions)
      .values({ id: id(), kind: 'opening_balance', date: '2026-09-01', status: 'cleared', accountId: acct[a.name], amount: a.opening, currency: a.currency, accountAmount: a.opening })
      .run();
  });
  db.insert(currencyOrder).values(['USD', 'PKR', 'EUR', 'AED', 'SAR'].map((currency, rank) => ({ currency, rank }))).run();

  const cat: Record<string, string> = {};
  const expenseCats = [
    { name: 'Client software', icon: 'monitor', color: 'blue' },
    { name: 'Groceries', icon: 'basket', color: 'orange' },
    { name: 'Health', icon: 'heart', color: 'pink' },
    { name: 'Office & Utilities', icon: 'bolt', color: 'cyan' },
    { name: 'Software & Subscriptions', icon: 'bank', color: 'purple' },
    { name: 'Travel', icon: 'suitcase', color: 'orange' },
  ];
  expenseCats.forEach((c, rank) => {
    cat[c.name] = id();
    db.insert(categories).values({ id: cat[c.name], kind: 'expense', rank, ...c }).run();
  });
  cat['Consulting income'] = id();
  cat['Retainer'] = id();
  cat['One-off projects'] = id();
  db.insert(categories)
    .values([
      { id: cat['Consulting income'], name: 'Consulting income', kind: 'income', icon: 'bolt', color: 'cyan', rank: 0 },
      { id: cat['Retainer'], name: 'Retainer', kind: 'income', icon: 'bolt', color: 'cyan', parentId: cat['Consulting income'], rank: 0 },
      { id: cat['One-off projects'], name: 'One-off projects', kind: 'income', icon: 'bolt', color: 'cyan', parentId: cat['Consulting income'], rank: 1 },
      { id: id(), name: 'Referral bonus', kind: 'income', icon: 'wallet', color: 'gold', rank: 1 },
      { id: id(), name: 'Other income', kind: 'income', icon: 'circle', color: 'neutral', rank: 2 },
    ])
    .run();

  const person: Record<string, string> = {};
  for (const name of ['John', 'Beta Client', 'Sana', 'Acme Corp']) {
    person[name] = id();
    db.insert(people).values({ id: person[name], name }).run();
  }

  const save = (draft: Partial<TransactionDraft> & Pick<TransactionDraft, 'kind' | 'date' | 'amount' | 'currency'>, marketRate?: string) =>
    saveTransaction(db, { status: 'cleared', ledgerId: personal, ...draft } as TransactionDraft, {
      today: SAMPLE_TODAY,
      marketRate: marketRate ? { rate: marketRate, fetchedAt: '2026-09-26T06:00:00Z' } : null,
    }).id;
  const usd = acct['Payoneer USD'];

  // Income in USD: $1,650 this month across both ledgers.
  save({ kind: 'income', date: '2026-09-03', accountId: usd, amount: '300', currency: 'USD', categoryId: cat['Retainer'], referencePersonId: person['Beta Client'] });
  save({ kind: 'income', date: '2026-09-05', accountId: usd, amount: '1200', currency: 'USD', categoryId: cat['Consulting income'], referencePersonId: person['Beta Client'], ledgerId: business });
  save({ kind: 'income', date: '2026-09-15', accountId: usd, amount: '100', currency: 'USD', categoryId: cat['One-off projects'] });
  save({ kind: 'income', date: '2026-09-28', accountId: usd, amount: '50', currency: 'USD', categoryId: cat['Consulting income'], referencePersonId: person['Acme Corp'] });

  // Personal spending in USD: $173 (Software $54, Groceries $50, Travel $35, Office & Utilities $34).
  save({ kind: 'expense', date: '2026-09-10', accountId: usd, amount: '39', currency: 'USD', categoryId: cat['Software & Subscriptions'] });
  save({ kind: 'expense', date: '2026-09-28', accountId: usd, amount: '15', currency: 'USD', categoryId: cat['Software & Subscriptions'] });
  save({ kind: 'expense', date: '2026-09-12', fromPersonId: person['John'], amount: '50', currency: 'USD', categoryId: cat['Groceries'], notes: 'Groceries, John paid' });
  save({ kind: 'expense', date: '2026-09-21', accountId: usd, amount: '35', currency: 'USD', categoryId: cat['Travel'] });
  save({ kind: 'expense', date: '2026-09-24', accountId: usd, amount: '10', currency: 'USD', categoryId: cat['Office & Utilities'] });
  save({ kind: 'expense', date: '2026-09-18', accountId: usd, amount: '24', currency: 'USD', categoryId: cat['Office & Utilities'], reimbursable: true, expectedFromPersonId: person['John'], notes: 'Printer cartridge' });
  const travel = save({ kind: 'expense', date: '2026-09-26', accountId: usd, amount: '120', currency: 'USD', categoryId: cat['Travel'], reimbursable: true, referencePersonId: person['Beta Client'], notes: 'Client travel expense\nSite visit, taxi + meals' });
  // Reimbursed in full on Sep 29: a linked row bringing the money back.
  db.insert(transactions)
    .values({ id: id(), kind: 'expense', date: '2026-09-29', status: 'cleared', ledgerId: personal, accountId: usd, amount: '120', currency: 'USD', accountAmount: '120', parentId: travel, linkType: 'reimbursement', countsAsAmount: '120', notes: 'Reimbursed by client' })
    .run();
  db.update(transactions).set({ reimbursementStatus: 'reimbursed' }).where(eq(transactions.id, travel)).run();

  // Business spending in USD: $840.
  save({ kind: 'expense', date: '2026-09-08', accountId: usd, amount: '15', currency: 'USD', categoryId: cat['Client software'], ledgerId: business, notes: 'Figma' });
  save({ kind: 'expense', date: '2026-09-14', accountId: usd, amount: '260', currency: 'USD', categoryId: cat['Client software'], ledgerId: business, notes: 'Hosting' });
  save({ kind: 'expense', date: '2026-09-19', accountId: usd, amount: '565', currency: 'USD', categoryId: cat['Travel'], ledgerId: business, notes: 'Client workshop trip' });

  // People: John owes you $250 and €40; you owe John ₨8,450.
  save({ kind: 'transfer', date: '2026-09-26', accountId: usd, toPersonId: person['John'], amount: '250', currency: 'USD', notes: 'Lent John for travel' });
  save({ kind: 'transfer', date: '2026-09-20', accountId: usd, toPersonId: person['John'], amount: '50', currency: 'USD', notes: 'Paid John back' });
  save({ kind: 'transfer', date: '2026-09-10', accountId: acct['Payoneer EUR'], toPersonId: person['John'], amount: '40', currency: 'EUR', notes: 'Lent John' });
  save({ kind: 'transfer', date: '2026-09-04', fromPersonId: person['John'], toAccountId: acct['Alfalah PKR'], amount: '7928.83', currency: 'PKR', notes: 'Borrowed from John' });
  save({ kind: 'expense', date: '2026-09-28', fromPersonId: person['John'], amount: '521.17', currency: 'PKR', notes: 'Dinner, John paid' });

  // PKR and other currencies.
  save({ kind: 'expense', date: '2026-09-27', accountId: acct['Alfalah PKR'], amount: '4200', currency: 'PKR', categoryId: cat['Groceries'] });
  save({ kind: 'expense', date: '2026-09-14', accountId: acct['Cash AED'], amount: '310', currency: 'AED', categoryId: cat['Travel'], notes: 'Dubai taxi + meals' });
  save({ kind: 'income', date: '2026-09-20', accountId: acct['Payoneer EUR'], amount: '340', currency: 'EUR', categoryId: cat['Consulting income'], notes: 'Riverbend LLC' });

  // A cleared withdrawal at ₨275 when the market said ₨278.10 (What converting cost you: ₨620 rate gap).
  save(
    { kind: 'transfer', date: '2026-09-15', accountId: usd, toAccountId: acct['Alfalah PKR'], amount: '200', currency: 'USD', rateMode: 'amount_known', knownAmount: '55000' },
    '278.10',
  );

  // Waiting in Needs review: a transfer in transit (with a ₨150 bank charge), a pending payout, an auto-added Netflix.
  save(
    {
      kind: 'transfer',
      date: '2026-09-26',
      accountId: usd,
      toAccountId: acct['Alfalah PKR'],
      amount: '49.46',
      currency: 'USD',
      status: 'in_transit',
      rateMode: 'amount_known',
      knownAmount: '13725',
      charges: [{ type: 'bank_charge', amount: '150', currency: 'PKR', deduction: 'charged_separately', accountId: acct['Alfalah PKR'] }],
    },
    '278.10',
  );
  save({ kind: 'income', date: '2026-09-20', accountId: usd, amount: '500', currency: 'USD', status: 'pending', expectedDate: '2026-10-14', notes: 'Upwork payout' });
  // Recurring (Home's Recurring section): Netflix auto-adds monthly; Adobe reminds; two bills vary.
  const recurring = (input: Omit<RecurringInput, 'showOnHomeDays'> & { showOnHomeDays?: number }) =>
    createRecurring(db, { showOnHomeDays: 7, ledgerId: personal, ...input }, SAMPLE_TODAY);
  const netflix = recurring({ kind: 'expense', amountType: 'same', name: 'Netflix', amount: '15.49', accountId: usd, categoryId: cat['Software & Subscriptions'], rule: { freq: 'monthly', interval: 1, day: 29 }, autoAdd: true, startOn: '2026-10-01' });
  db.update(recurringItems).set({ occurrences: 1 }).where(eq(recurringItems.id, netflix)).run();
  save({ kind: 'expense', date: '2026-09-29', accountId: usd, amount: '15.49', currency: 'USD', status: 'pending', categoryId: cat['Software & Subscriptions'], notes: 'Netflix', autoAdded: true, recurringId: netflix, recurringDueDate: '2026-09-29' });
  recurring({ kind: 'expense', amountType: 'same', name: 'Adobe Creative Cloud', amount: '54.99', accountId: usd, categoryId: cat['Software & Subscriptions'], rule: { freq: 'monthly', interval: 1, day: 6 }, autoAdd: false });
  recurring({ kind: 'expense', amountType: 'varies', name: 'Electricity', accountId: acct['Cash PKR'], categoryId: cat['Office & Utilities'], rule: { freq: 'monthly', interval: 1, day: 5 }, autoAdd: false });
  const internet = recurring({ kind: 'expense', amountType: 'varies', name: 'Internet', accountId: acct['Alfalah PKR'], categoryId: cat['Office & Utilities'], rule: { freq: 'monthly', interval: 1, day: 3 }, autoAdd: false });
  db.update(recurringItems).set({ lastAmount: '5500' }).where(eq(recurringItems.id, internet)).run();

  // Upcoming (future-dated): wait in Needs review, count nowhere yet.
  save({ kind: 'expense', date: '2026-10-26', accountId: acct['Alfalah PKR'], amount: '12500', currency: 'PKR', categoryId: cat['Office & Utilities'] });
  save({ kind: 'expense', date: '2026-10-26', accountId: acct['Alfalah PKR'], amount: '6000', currency: 'PKR' });

  // Goals: Emergency fund $400 set aside from Payoneer USD; New laptop empty.
  const emergency = id();
  db.insert(savingsGoals)
    .values([
      { id: emergency, name: 'Emergency fund', currency: 'USD', targetAmount: '2000.00', priority: 1 },
      { id: id(), name: 'New laptop', currency: 'USD', targetAmount: '1250.00', priority: 2 },
    ])
    .run();
  addToGoal(db, { goalId: emergency, accountId: usd, amount: '400.00', date: '2026-09-01' });

  // Budgets (Personal ledger): All spending $180; Software $50; Travel $100; Office & Utilities $40; Groceries ₨3,100.
  createBudget(db, { ledgerId: personal, categoryId: null, currency: 'USD', amount: '180' });
  createBudget(db, { ledgerId: personal, categoryId: cat['Software & Subscriptions'], currency: 'USD', amount: '50' });
  createBudget(db, { ledgerId: personal, categoryId: cat['Travel'], currency: 'USD', amount: '100' });
  createBudget(db, { ledgerId: personal, categoryId: cat['Office & Utilities'], currency: 'USD', amount: '40' });
  createBudget(db, { ledgerId: personal, categoryId: cat['Groceries'], currency: 'PKR', amount: '3100' });

  // Market rates as of Sep 30 (≈ total $2,447.69); a live refresh replaces them.
  storeRates(db, { PKR: '278.10', EUR: '0.925926', AED: '3.6731', SAR: '3.75' }, '2026-09-30T06:00:00.000Z');
}
