import { transactionCharges } from '@/db/schema';
import { accountBalance, accountBalances } from '../balances';
import { setup } from '@/test/factories';

const TODAY = '2026-09-30';

describe('account balances', () => {
  it('starts from the opening balance and applies cleared income and spending', async () => {
    const { account, tx, db } = await setup();
    const usd = account('Payoneer USD', 'USD');
    tx({ kind: 'opening_balance', accountId: usd, amount: '1000', accountAmount: '1000', date: '2026-09-01' });
    tx({ kind: 'income', accountId: usd, amount: '530', accountAmount: '500', date: '2026-09-05' });
    tx({ kind: 'expense', accountId: usd, amount: '15.49', accountAmount: '15.49', date: '2026-09-29' });
    expect(accountBalance(db, usd, TODAY)).toBe('1484.51');
  });

  it('ignores pending, cancelled, future-dated, scheduled and deleted rows', async () => {
    const { account, tx, db } = await setup();
    const usd = account('Payoneer USD', 'USD');
    tx({ kind: 'income', accountId: usd, accountAmount: '100', status: 'pending' });
    tx({ kind: 'expense', accountId: usd, accountAmount: '50', status: 'cancelled' });
    tx({ kind: 'expense', accountId: usd, accountAmount: '20', date: '2026-10-01' });
    tx({ kind: 'expense', accountId: usd, accountAmount: '20', scheduled: true });
    tx({ kind: 'expense', accountId: usd, accountAmount: '20', deletedAt: '2026-09-20T00:00:00Z' });
    expect(accountBalance(db, usd, TODAY)).toBe('0');
  });

  it('takes an in-transit transfer out of From but adds it to To only once cleared', async () => {
    const { account, tx, db } = await setup();
    const usd = account('Payoneer USD', 'USD');
    const pkr = account('Alfalah PKR', 'PKR');
    tx({ kind: 'transfer', accountId: usd, accountAmount: '49.46', toAccountId: pkr, toAmount: '13725', status: 'in_transit' });
    let b = accountBalances(db, TODAY);
    expect([b.get(usd), b.get(pkr)]).toEqual(['-49.46', undefined]);

    tx({ kind: 'transfer', accountId: usd, accountAmount: '100', toAccountId: pkr, toAmount: '27750', status: 'cleared' });
    b = accountBalances(db, TODAY);
    expect([b.get(usd), b.get(pkr)]).toEqual(['-149.46', '27750']);
  });

  it('adds refunds back and subtracts on-top charges from their own account', async () => {
    const { account, tx, db } = await setup();
    const usd = account('Payoneer USD', 'USD');
    const pkr = account('Alfalah PKR', 'PKR');
    const adobe = tx({ kind: 'expense', accountId: usd, accountAmount: '54.99' });
    tx({ kind: 'expense', accountId: pkr, accountAmount: '1000', parentId: adobe, linkType: 'refund', currency: 'PKR' });
    const income = tx({ kind: 'income', accountId: pkr, amount: '530', accountAmount: '133500', currency: 'USD' });
    db.insert(transactionCharges)
      .values([
        { id: 'tax', transactionId: income, type: 'withholding_tax', amount: '1200', currency: 'PKR', deduction: 'charged_separately', accountId: pkr, isTax: true },
        { id: 'bank', transactionId: income, type: 'bank_charge', amount: '150', currency: 'PKR', deduction: 'charged_separately', accountId: pkr },
        { id: 'fee', transactionId: income, type: 'transfer_fee', amount: '30', currency: 'USD', deduction: 'already_deducted' },
      ])
      .run();
    const b = accountBalances(db, TODAY);
    // Spec §11a example: Alfalah goes up by ₨1,32,150.00 (plus the ₨1,000 refund).
    expect(b.get(pkr)).toBe('133150');
    expect(b.get(usd)).toBe('-54.99');
  });

  it("doesn't count a pending transaction's on-top charges", async () => {
    const { account, tx, db } = await setup();
    const pkr = account('Alfalah PKR', 'PKR');
    const t = tx({ kind: 'income', accountId: pkr, accountAmount: '100', status: 'pending' });
    db.insert(transactionCharges)
      .values({ id: 'c', transactionId: t, type: 'bank_charge', amount: '5', currency: 'PKR', deduction: 'charged_separately', accountId: pkr })
      .run();
    expect(accountBalance(db, pkr, TODAY)).toBe('0');
  });

  it('skips "Paid from → Person" expenses, which move no account', async () => {
    const { account, person, tx, db } = await setup();
    const usd = account('Payoneer USD', 'USD');
    tx({ kind: 'expense', accountId: null, paidByPersonId: person('John'), accountAmount: null, amount: '20' });
    expect(accountBalance(db, usd, TODAY)).toBe('0');
  });
});
