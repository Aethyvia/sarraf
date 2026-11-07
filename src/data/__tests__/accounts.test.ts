import { eq } from 'drizzle-orm';

import {
  accounts,
  attachments,
  currencyOrder,
  goalAllocations,
  personEntries,
  savingsGoals,
  transactionCharges,
  transactions,
} from '@/db/schema';
import {
  accountDeletionImpact,
  archiveAccount,
  createAccount,
  deleteAccount,
  setAsideByGoal,
  unarchiveAccount,
  updateAccount,
} from '../accounts';
import { DataError } from '../errors';
import { LimitReachedError } from '../limits';
import { setup } from '@/test/factories';

describe('creating accounts', () => {
  it('needs only a name and currency, and picks a default look', async () => {
    const { db } = await setup();
    const id = createAccount(db, { name: '  Cash AED ', currency: 'AED' }, 'free');
    const row = db.select().from(accounts).where(eq(accounts.id, id)).get()!;
    expect(row).toMatchObject({ name: 'Cash AED', currency: 'AED', icon: 'cash', color: 'gold', archivedAt: null });
    expect(db.select().from(transactions).all()).toHaveLength(0);
  });

  it('uses the wallet look for an institution and the bank look otherwise', async () => {
    const { db } = await setup();
    const p = createAccount(db, { name: 'Payoneer USD', currency: 'USD', institution: 'Payoneer' }, 'free');
    const b = createAccount(db, { name: 'Alfalah PKR', currency: 'PKR' }, 'free');
    const get = (id: string) => db.select().from(accounts).where(eq(accounts.id, id)).get()!;
    expect(get(p)).toMatchObject({ icon: 'wallet', color: 'orange', institution: 'Payoneer' });
    expect(get(b)).toMatchObject({ icon: 'bank', color: 'teal', institution: null });
  });

  it('turns "Current balance" into one dated Opening balance transaction', async () => {
    const { db } = await setup();
    const id = createAccount(db, { name: 'Alfalah PKR', currency: 'PKR', currentBalance: '104231.750' }, 'free');
    const rows = db.select().from(transactions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'opening_balance',
      status: 'cleared',
      accountId: id,
      amount: '104231.75',
      accountAmount: '104231.75',
      currency: 'PKR',
    });
    expect(rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('allows a negative opening balance (e.g. a credit card) and skips zero', async () => {
    const { db } = await setup();
    createAccount(db, { name: 'Card', currency: 'USD', currentBalance: '-250' }, 'free');
    createAccount(db, { name: 'Empty', currency: 'USD', currentBalance: '0.00' }, 'free');
    expect(db.select({ a: transactions.amount }).from(transactions).all()).toEqual([{ a: '-250' }]);
  });

  it('rejects a missing name, an unknown currency and a malformed balance', async () => {
    const { db } = await setup();
    expect(() => createAccount(db, { name: ' ', currency: 'USD' }, 'free')).toThrow(DataError);
    expect(() => createAccount(db, { name: 'X', currency: 'XYZ' }, 'free')).toThrow(/currency/);
    expect(() => createAccount(db, { name: 'X', currency: 'USD', currentBalance: '1,000' }, 'free')).toThrow(
      /amount/,
    );
    expect(db.select().from(accounts).all()).toHaveLength(0);
  });

  it('adds a Home tile for a new currency at the end of the order, once', async () => {
    const { account, db } = await setup();
    account('Payoneer USD', 'USD');
    account('Alfalah PKR', 'PKR');
    account('Cash PKR', 'PKR');
    expect(db.select().from(currencyOrder).orderBy(currencyOrder.rank).all().map((r) => r.currency)).toEqual([
      'USD',
      'PKR',
    ]);
  });
});

describe('free-plan account limit', () => {
  it('allows 5 accounts on Free, then refuses the 6th', async () => {
    const { db } = await setup();
    for (let i = 1; i <= 5; i++) createAccount(db, { name: `A${i}`, currency: 'USD' }, 'free');
    expect(() => createAccount(db, { name: 'A6', currency: 'USD' }, 'free')).toThrow(LimitReachedError);
    expect(db.select().from(accounts).all()).toHaveLength(5);
  });

  it('has no limit on Plus', async () => {
    const { db } = await setup();
    for (let i = 1; i <= 7; i++) createAccount(db, { name: `A${i}`, currency: 'USD' }, 'plus');
    expect(db.select().from(accounts).all()).toHaveLength(7);
  });

  it("doesn't count archived accounts, and unarchiving counts like adding one", async () => {
    const { db } = await setup();
    const ids = [1, 2, 3, 4, 5].map((i) => createAccount(db, { name: `A${i}`, currency: 'USD' }, 'free'));
    archiveAccount(db, ids[0]);
    createAccount(db, { name: 'A6', currency: 'USD' }, 'free');
    expect(() => unarchiveAccount(db, ids[0], 'free')).toThrow(LimitReachedError);
    unarchiveAccount(db, ids[0], 'plus');
    expect(db.select().from(accounts).where(eq(accounts.id, ids[0])).get()!.archivedAt).toBeNull();
  });
});

describe('editing accounts', () => {
  it('renames and restyles but never changes currency', async () => {
    const { account, db } = await setup();
    const id = account('Payoneer USD', 'USD');
    updateAccount(db, id, { name: 'Payoneer $', icon: 'star', color: 'blue' });
    expect(db.select().from(accounts).where(eq(accounts.id, id)).get()).toMatchObject({
      name: 'Payoneer $',
      icon: 'star',
      color: 'blue',
      currency: 'USD',
    });
    expect(() => updateAccount(db, id, { name: '' })).toThrow(DataError);
    expect(() => updateAccount(db, 'missing', { name: 'x' })).toThrow(/No account/);
  });
});

describe('archiving an account', () => {
  it('releases everything it had set aside, per goal, and keeps history', async () => {
    const { account, db } = await setup();
    const usd = account('Payoneer USD', 'USD');
    const usd2 = account('Wise USD', 'USD');
    const goal = 'g1';
    db.insert(savingsGoals).values({ id: goal, name: 'Emergency fund', currency: 'USD', targetAmount: '2000', priority: 1 }).run();
    const alloc = (accountId: string, kind: 'add' | 'take_out', amount: string) =>
      db
        .insert(goalAllocations)
        .values({ id: `${accountId}-${amount}`, goalId: goal, accountId, kind, amount, date: '2026-09-01' })
        .run();
    alloc(usd, 'add', '400');
    alloc(usd, 'take_out', '-50');
    alloc(usd2, 'add', '100');

    expect(setAsideByGoal(db, usd)).toEqual([{ goalId: goal, goalName: 'Emergency fund', amount: '350' }]);
    archiveAccount(db, usd);

    const release = db.select().from(goalAllocations).where(eq(goalAllocations.kind, 'release')).all();
    expect(release).toHaveLength(1);
    expect(release[0]).toMatchObject({ accountId: usd, amount: '-350', goalId: goal });
    expect(setAsideByGoal(db, usd)).toEqual([]);
    expect(setAsideByGoal(db, usd2)).toEqual([{ goalId: goal, goalName: 'Emergency fund', amount: '100' }]);

    // Archiving twice doesn't release twice.
    archiveAccount(db, usd);
    expect(db.select().from(goalAllocations).where(eq(goalAllocations.kind, 'release')).all()).toHaveLength(1);
  });
});

describe('deleting an account in use', () => {
  it('reports how many transactions use it, over which dates, and which other balances change', async () => {
    const { account, person, tx, db } = await setup();
    const usd = account('Payoneer USD', 'USD');
    const pkr = account('Alfalah PKR', 'PKR');
    const cash = account('Cash PKR', 'PKR');
    const john = person('John');

    tx({ accountId: usd, date: '2026-09-03' });
    const transfer = tx({ kind: 'transfer', accountId: usd, toAccountId: pkr, date: '2026-09-28', amount: '49.46' });
    db.insert(transactionCharges)
      .values({ id: 'c1', transactionId: transfer, type: 'bank_charge', amount: '150', currency: 'PKR', deduction: 'charged_separately', accountId: cash })
      .run();
    const lend = tx({ kind: 'transfer', accountId: usd, transferPersonId: john, date: '2026-09-10' });
    db.insert(personEntries)
      .values({ id: 'p1', personId: john, transactionId: lend, source: 'transfer', currency: 'USD', amount: '250', date: '2026-09-10' })
      .run();
    tx({ accountId: pkr, date: '2026-08-01' }); // doesn't use USD
    tx({ accountId: usd, date: '2026-07-01', deletedAt: '2026-09-01T00:00:00Z' }); // soft-deleted: goes, not counted

    const impact = accountDeletionImpact(db, usd);
    expect(impact).toMatchObject({ count: 3, firstDate: '2026-09-03', lastDate: '2026-09-28' });
    expect(impact.otherAccounts.map((a) => a.name)).toEqual(['Alfalah PKR', 'Cash PKR']);
    expect(impact.people.map((p) => p.name)).toEqual(['John']);
  });

  it('deletes it with its transactions, their linked refunds, charges, entries and attachments', async () => {
    const { account, person, tx, db } = await setup();
    const usd = account('Payoneer USD', 'USD');
    const pkr = account('Alfalah PKR', 'PKR', '1000');
    const john = person('John');

    const expense = tx({ accountId: usd, amount: '30' });
    tx({ accountId: pkr, parentId: expense, linkType: 'refund', amount: '5000', currency: 'PKR' }); // refund elsewhere
    db.insert(attachments).values({ id: 'a1', transactionId: expense, filePath: 'att/receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }).run();
    const lend = tx({ kind: 'transfer', accountId: usd, transferPersonId: john });
    db.insert(personEntries)
      .values({ id: 'p1', personId: john, transactionId: lend, source: 'transfer', currency: 'USD', amount: '250', date: '2026-09-10' })
      .run();
    db.insert(savingsGoals).values({ id: 'g', name: 'G', currency: 'USD', targetAmount: '1', priority: 1 }).run();
    db.insert(goalAllocations).values({ id: 'ga', goalId: 'g', accountId: usd, kind: 'add', amount: '1', date: '2026-09-01' }).run();

    const { attachmentPaths } = deleteAccount(db, usd);

    expect(attachmentPaths).toEqual(['att/receipt.jpg']);
    expect(db.select().from(accounts).all().map((a) => a.name)).toEqual(['Alfalah PKR']);
    // Only Alfalah's opening balance is left: the linked refund went with its expense.
    expect(db.select({ kind: transactions.kind }).from(transactions).all()).toEqual([{ kind: 'opening_balance' }]);
    expect(db.select().from(attachments).all()).toHaveLength(0);
    expect(db.select().from(personEntries).all()).toHaveLength(0);
    expect(db.select().from(goalAllocations).all()).toHaveLength(0);
  });

  it('deletes an unused account', async () => {
    const { account, db } = await setup();
    const id = account('Cash SAR', 'SAR');
    expect(accountDeletionImpact(db, id)).toMatchObject({ count: 0, firstDate: null, otherAccounts: [] });
    deleteAccount(db, id);
    expect(db.select().from(accounts).all()).toHaveLength(0);
  });
});
