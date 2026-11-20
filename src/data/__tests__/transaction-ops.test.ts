import { eq } from 'drizzle-orm';

import { attachments, transactions } from '@/db/schema';
import { accountBalance, balanceSeries } from '../balances';
import { cancelTransaction } from '../review';
import {
  bulkUpdate,
  undoBulk,
  deleteTransaction,
  deletionSet,
  fixBalance,
  pendingOnAccount,
  purgeSoftDeleted,
  restoreCancelled,
  restoreTransactions,
  softDeleteTransactions,
} from '../transaction-ops';
import { setup } from '@/test/factories';

const TODAY = '2026-09-30';

async function world() {
  const s = await setup();
  const usd = s.account('Payoneer USD', 'USD');
  const wise = s.account('Wise USD', 'USD');
  const pkr = s.account('Alfalah PKR', 'PKR');
  s.tx({ kind: 'opening_balance', accountId: usd, amount: '1000', accountAmount: '1000', date: '2026-09-01' });
  return { ...s, usd, wise, pkr };
}

describe('deleting a transaction', () => {
  it('takes its linked refunds and attachments with it', async () => {
    const w = await world();
    const expense = w.tx({ accountId: w.usd, accountAmount: '120', amount: '120', date: '2026-09-26' });
    const refund = w.tx({ accountId: w.usd, accountAmount: '120', amount: '120', parentId: expense, linkType: 'reimbursement', date: '2026-09-29' });
    w.db.insert(attachments).values({ id: 'a', transactionId: expense, filePath: 'attachments/a.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }).run();
    expect(deletionSet(w.db, expense).map((t) => t.id).sort()).toEqual([expense, refund].sort());
    expect(deleteTransaction(w.db, expense)).toEqual({ attachmentPaths: ['attachments/a.jpg'] });
    expect(w.db.select().from(transactions).where(eq(transactions.id, refund)).get()).toBeUndefined();
  });

  it('bulk delete is soft: Undo restores it, linked rows included; purge removes it for good', async () => {
    const w = await world();
    const a = w.tx({ accountId: w.usd, accountAmount: '100' });
    const child = w.tx({ accountId: w.usd, accountAmount: '10', parentId: a, linkType: 'refund' });
    const hidden = softDeleteTransactions(w.db, [a]);
    expect(hidden.sort()).toEqual([a, child].sort());
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('1000');
    restoreTransactions(w.db, hidden);
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('910');
    softDeleteTransactions(w.db, [a]);
    purgeSoftDeleted(w.db, '2999-01-01T00:00:00Z');
    expect(w.db.select().from(transactions).all().filter((t) => t.kind === 'expense')).toHaveLength(0);
  });
});

describe('Cancelled and restored', () => {
  it('restoring brings it back as Cleared (or Upcoming when it’s in the future)', async () => {
    const w = await world();
    const a = w.tx({ accountId: w.usd, accountAmount: '100', date: '2026-09-15', status: 'pending' });
    const b = w.tx({ accountId: w.usd, accountAmount: '100', date: '2026-10-15', scheduled: true });
    cancelTransaction(w.db, a);
    cancelTransaction(w.db, b);
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('1000');
    restoreCancelled(w.db, a, TODAY);
    restoreCancelled(w.db, b, TODAY);
    const row = (id: string) => w.db.select().from(transactions).where(eq(transactions.id, id)).get()!;
    expect([row(a).status, row(a).scheduled, row(b).status, row(b).scheduled]).toEqual(['cleared', false, 'cleared', true]);
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('900');
  });
});

describe('bulk actions', () => {
  it('apply only where they fit', async () => {
    const w = await world();
    const travel = w.category('Travel');
    const salary = w.category('Salary', 'income');
    const e1 = w.tx({ accountId: w.usd, accountAmount: '10' });
    const e2 = w.tx({ accountId: w.pkr, accountAmount: '10', currency: 'PKR' });
    const inc = w.tx({ kind: 'income', accountId: w.usd, accountAmount: '50' });

    expect(bulkUpdate(w.db, [e1, e2, inc], { field: 'category', categoryId: travel }).changed).toBe(2);
    expect(bulkUpdate(w.db, [inc], { field: 'category', categoryId: salary }).changed).toBe(1);
    // Change account: only rows already in the target's currency.
    const moved = bulkUpdate(w.db, [e1, e2, inc], { field: 'account', accountId: w.wise });
    expect(moved.changed).toBe(2);
    const row = (id: string) => w.db.select().from(transactions).where(eq(transactions.id, id)).get()!;
    expect([row(e1).accountId, row(e2).accountId, row(inc).accountId]).toEqual([w.wise, w.pkr, w.wise]);
    expect([row(e1).categoryId, row(inc).categoryId]).toEqual([travel, salary]);

    // Undo puts back exactly what the change replaced.
    undoBulk(w.db, moved.undo);
    expect([row(e1).accountId, row(e2).accountId, row(inc).accountId]).toEqual([w.usd, w.pkr, w.usd]);
  });
});

describe('Fix balance', () => {
  it('adds a dated Balance adjustment for the difference on that date', async () => {
    const w = await world();
    w.tx({ accountId: w.usd, accountAmount: '200', date: '2026-09-20' });
    const { difference } = fixBalance(w.db, w.usd, '812.40', TODAY, TODAY);
    expect(difference).toBe('12.4');
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('812.4');

    // A past date compares with the balance on that date.
    const past = fixBalance(w.db, w.usd, '950', '2026-09-10', TODAY);
    expect(past.difference).toBe('-50');
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('762.4');
    expect(() => fixBalance(w.db, w.usd, '762.40', TODAY, TODAY)).toThrow(/already matches/);
  });

  it('counts pending items on the account for the warning', async () => {
    const w = await world();
    w.tx({ accountId: w.usd, accountAmount: '5', status: 'pending' });
    w.tx({ kind: 'transfer', accountId: w.pkr, toAccountId: w.usd, accountAmount: '5', status: 'in_transit' });
    w.tx({ accountId: w.pkr, accountAmount: '5', status: 'pending' });
    expect(pendingOnAccount(w.db, w.usd)).toBe(2);
  });
});

describe('balance trend', () => {
  it('gives end-of-day balances, starting from what came before', async () => {
    const w = await world();
    w.tx({ accountId: w.usd, accountAmount: '100', date: '2026-09-28' });
    w.tx({ kind: 'income', accountId: w.usd, accountAmount: '50', date: '2026-09-30' });
    expect(balanceSeries(w.db, w.usd, '2026-09-27', '2026-09-30')).toEqual([
      { date: '2026-09-27', balance: '1000' },
      { date: '2026-09-28', balance: '900' },
      { date: '2026-09-29', balance: '900' },
      { date: '2026-09-30', balance: '950' },
    ]);
  });
});
