import { eq } from 'drizzle-orm';

import { personEntries, splitShares, transactions } from '@/db/schema';
import { accountBalance } from '../balances';
import { addMoneyBack, refundableLeft, writeOff } from '../money-back';
import { deleteSettlement, expectedBack, markSettled, offsetBalances, personBalances, personHistory, settleInOtherCurrency, sharesKeptByRefund } from '../owing';
import { confirmTransaction } from '../review';
import { equalShares, percentShares, remainingToAssign } from '../splits';
import { deleteTransaction, restoreTransactions, softDeleteTransactions } from '../transaction-ops';
import { draftFromTransaction, saveTransaction, type TransactionDraft } from '../transactions';
import { shareSummaryText } from '../share-summary';
import { setup } from '@/test/factories';

const TODAY = '2026-09-30';

async function world() {
  const s = await setup();
  const usd = s.account('Payoneer USD', 'USD');
  const pkr = s.account('Alfalah PKR', 'PKR');
  s.tx({ kind: 'opening_balance', accountId: usd, amount: '1000', accountAmount: '1000', date: '2026-09-01' });
  s.tx({ kind: 'opening_balance', accountId: pkr, amount: '100000', currency: 'PKR', accountAmount: '100000', date: '2026-09-01' });
  const john = s.person('John');
  const sana = s.person('Sana');
  const save = (draft: Partial<TransactionDraft>, id?: string) =>
    saveTransaction(s.db, { kind: 'expense', date: '2026-09-20', status: 'cleared', amount: '0', currency: 'USD', ...draft } as TransactionDraft, { id, today: TODAY }).id;
  const balance = (person: string) => Object.fromEntries(personBalances(s.db, person, TODAY));
  const row = (id: string) => s.db.select().from(transactions).where(eq(transactions.id, id)).get()!;
  return { ...s, usd, pkr, john, sana, save, balance, row };
}

describe('split shares add up exactly', () => {
  it('equal: leftover cents go to the first rows', () => {
    expect(equalShares('100', 3, 'USD')).toEqual(['33.34', '33.33', '33.33']);
    expect(equalShares('1563.51', 3, 'PKR')).toEqual(['521.17', '521.17', '521.17']);
    expect(equalShares('10', 3, 'JPY')).toEqual(['4', '3', '3']);
  });

  it('percent: the last row takes the rounding so the total is exact', () => {
    expect(percentShares('100', ['33.3', '33.3', '33.4'], 'USD')).toEqual(['33.3', '33.3', '33.4']);
    expect(percentShares('10', ['33.33', '33.33', '33.34'], 'USD')).toEqual(['3.33', '3.33', '3.34']);
  });

  it('remaining to assign reaches zero', () => {
    expect(remainingToAssign('90', [{ amount: '30' }, { amount: '30' }])).toBe('30');
    expect(remainingToAssign('90', [{ amount: '30' }, { amount: '30' }, { amount: '30' }])).toBe('0');
  });
});

describe('I paid: a split', () => {
  it('takes the whole bill from your account; others’ untreated shares are owed to you', async () => {
    const w = await world();
    const id = w.save({
      accountId: w.usd,
      amount: '90',
      split: {
        mode: 'equal',
        shares: [
          { personId: null, amount: '30' },
          { personId: w.john, amount: '30' },
          { personId: w.sana, amount: '30', treat: true },
        ],
      },
    });
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('910');
    expect(w.balance(w.john)).toEqual({ USD: '30' });
    // A treat owes nothing.
    expect(w.balance(w.sana)).toEqual({});
    expect(w.db.select().from(splitShares).where(eq(splitShares.transactionId, id)).all()).toHaveLength(3);
  });

  it('splits in the account’s currency when the bill was in another one', async () => {
    const w = await world();
    w.save({
      accountId: w.usd,
      amount: '110',
      currency: 'AED',
      rate: '0.27',
      split: { mode: 'amounts', shares: [{ personId: null, amount: '14.70' }, { personId: w.john, amount: '15' }] },
    });
    expect(w.balance(w.john)).toEqual({ USD: '15' });
  });

  it('won’t save until the shares add up', async () => {
    const w = await world();
    expect(() =>
      w.save({ accountId: w.usd, amount: '90', split: { mode: 'amounts', shares: [{ personId: null, amount: '30' }, { personId: w.john, amount: '30' }] } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_split' }));
    expect(() =>
      w.save({
        accountId: w.usd,
        amount: '90',
        split: { mode: 'percent', shares: [{ personId: null, amount: '45', percent: '50' }, { personId: w.john, amount: '45', percent: '40' }] },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_split' }));
  });

  it('editing rewrites the shares; a repayment stays and the balance can flip', async () => {
    const w = await world();
    const shares = (john: string, you: string) => ({ mode: 'amounts' as const, shares: [{ personId: null, amount: you }, { personId: w.john, amount: john }] });
    const id = w.save({ accountId: w.usd, amount: '100', split: shares('60', '40') });
    // John pays $50 back.
    w.save({ kind: 'transfer', toAccountId: w.usd, fromPersonId: w.john, amount: '50', date: '2026-09-22' });
    expect(w.balance(w.john)).toEqual({ USD: '10' });
    w.save({ accountId: w.usd, amount: '100', split: shares('20', '80') }, id);
    expect(w.balance(w.john)).toEqual({ USD: '-30' });
    expect(draftFromTransaction(w.db, id).split?.shares.map((s) => s.amount)).toEqual(['80', '20']);
  });
});

describe('Someone else paid: a split', () => {
  it('stores your share as the expense; only your share is owed, to the payer', async () => {
    const w = await world();
    const id = w.save({
      fromPersonId: w.john,
      amount: '1563.51',
      currency: 'PKR',
      split: {
        mode: 'equal',
        shares: [
          { personId: null, amount: '521.17' },
          { personId: w.john, amount: '521.17' },
          { personId: w.sana, amount: '521.17' },
        ],
      },
    });
    expect(w.row(id).amount).toBe('521.17');
    expect(w.balance(w.john)).toEqual({ PKR: '-521.17' });
    expect(w.balance(w.sana)).toEqual({});
    expect(accountBalance(w.db, w.pkr, TODAY)).toBe('100000');
    // Edit shows the whole bill again.
    expect(draftFromTransaction(w.db, id).amount).toBe('1563.51');
  });

  it('without a split, Paid by → Person owes the whole amount', async () => {
    const w = await world();
    w.save({ fromPersonId: w.john, amount: '50' });
    expect(w.balance(w.john)).toEqual({ USD: '-50' });
  });
});

describe('a person’s balance', () => {
  it('counts only cleared, non-future entries; settlements always count', async () => {
    const w = await world();
    w.save({ kind: 'transfer', accountId: w.usd, toPersonId: w.john, amount: '250', date: '2026-09-26' });
    const pending = w.save({ kind: 'transfer', accountId: w.usd, toPersonId: w.john, amount: '100', status: 'pending' });
    w.save({ kind: 'transfer', accountId: w.usd, toPersonId: w.john, amount: '70', date: '2026-10-05' });
    w.save({ kind: 'transfer', fromPersonId: w.john, toAccountId: w.pkr, amount: '7928.83', date: '2026-09-04' });
    expect(w.balance(w.john)).toEqual({ USD: '250', PKR: '-7928.83' });
    confirmTransaction(w.db, pending, '2026-09-20', TODAY);
    expect(w.balance(w.john)).toEqual({ USD: '350', PKR: '-7928.83' });

    const history = personHistory(w.db, w.john, TODAY);
    expect(history[0]).toMatchObject({ counts: false, running: '350' });
    expect(history.filter((h) => h.entry.currency === 'USD' && h.counts).map((h) => h.running)).toEqual(['350', '100']);
  });

  it('Mark as settled moves the balance toward zero, full or part, without moving any account', async () => {
    const w = await world();
    w.save({ kind: 'transfer', accountId: w.usd, toPersonId: w.john, amount: '250' });
    w.save({ fromPersonId: w.john, amount: '8450', currency: 'PKR' });
    markSettled(w.db, { personId: w.john, currency: 'USD', amount: '100', note: 'Cash at lunch' }, TODAY);
    markSettled(w.db, { personId: w.john, currency: 'PKR', amount: '8450' }, TODAY);
    expect(w.balance(w.john)).toEqual({ USD: '150', PKR: '0' });
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('750');
    expect(() => markSettled(w.db, { personId: w.john, currency: 'USD', amount: '151' }, TODAY)).toThrow(expect.objectContaining({ code: 'invalid_amount' }));
    expect(() => markSettled(w.db, { personId: w.john, currency: 'PKR', amount: '1' }, TODAY)).toThrow(expect.objectContaining({ code: 'nothing_owed' }));
  });

  it('settles in another currency: the money moves in the account’s currency, the balance clears in the owed one', async () => {
    const w = await world();
    w.save({ kind: 'transfer', accountId: w.usd, toPersonId: w.john, amount: '250' });
    // John pays back ₨69,500 into Alfalah PKR for the $250 (278.00 a dollar).
    const id = settleInOtherCurrency(w.db, { personId: w.john, currency: 'USD', clears: '250', accountId: w.pkr, amount: '69500', note: 'Cash in PKR' }, TODAY);
    expect(w.balance(w.john)).toEqual({ USD: '0' });
    expect(accountBalance(w.db, w.pkr, TODAY)).toBe('169500');
    expect(w.row(id)).toMatchObject({ kind: 'transfer', currency: 'PKR', amount: '69500', transferPersonId: w.john, personCurrency: 'USD', personAmount: '250' });

    // Editing it (e.g. a corrected note) keeps clearing the same $250, not ₨69,500.
    const draft = draftFromTransaction(w.db, id);
    expect(draft).toMatchObject({ personCurrency: 'USD', personAmount: '250' });
    saveTransaction(w.db, { ...draft, notes: 'Cash in PKR, at lunch' }, { id, today: TODAY });
    expect(w.balance(w.john)).toEqual({ USD: '0' });
  });

  it('settles part of it, and the other way: you owe them, so the money leaves your account', async () => {
    const w = await world();
    w.save({ kind: 'transfer', fromPersonId: w.john, toAccountId: w.usd, amount: '100' }); // you borrowed $100
    settleInOtherCurrency(w.db, { personId: w.john, currency: 'USD', clears: '40', accountId: w.pkr, amount: '11120' }, TODAY);
    expect(w.balance(w.john)).toEqual({ USD: '-60' });
    expect(accountBalance(w.db, w.pkr, TODAY)).toBe('88880');
  });

  it('refuses more than the balance, the same currency, or nothing owed', async () => {
    const w = await world();
    w.save({ kind: 'transfer', accountId: w.usd, toPersonId: w.john, amount: '250' });
    const bad = (input: Partial<Parameters<typeof settleInOtherCurrency>[1]>) =>
      () => settleInOtherCurrency(w.db, { personId: w.john, currency: 'USD', clears: '250', accountId: w.pkr, amount: '69500', ...input }, TODAY);
    expect(bad({ clears: '251' })).toThrow(expect.objectContaining({ code: 'invalid_amount' }));
    expect(bad({ amount: '0' })).toThrow(expect.objectContaining({ code: 'invalid_amount' }));
    expect(bad({ accountId: w.usd })).toThrow(expect.objectContaining({ code: 'same_currency' }));
    expect(bad({ currency: 'EUR' })).toThrow(expect.objectContaining({ code: 'nothing_owed' }));
  });

  it('settles one currency against another: no account moves, both balances move toward zero', async () => {
    const w = await world();
    w.save({ kind: 'transfer', accountId: w.usd, toPersonId: w.john, amount: '250' }); // John owes you $250
    w.save({ fromPersonId: w.john, amount: '8450', currency: 'PKR' }); // you owe John ₨8,450
    // ₨8,450 set against $30.40 of the loan (278.00).
    const group = offsetBalances(w.db, { personId: w.john, a: { currency: 'PKR', amount: '8450' }, b: { currency: 'USD', amount: '30.40' } }, TODAY);
    expect(w.balance(w.john)).toEqual({ USD: '219.6', PKR: '0' });
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('750');
    expect(accountBalance(w.db, w.pkr, TODAY)).toBe('100000');

    // Removing either half removes both.
    const half = w.db.select().from(personEntries).where(eq(personEntries.offsetGroup, group)).all();
    expect(half).toHaveLength(2);
    deleteSettlement(w.db, half[1].id);
    expect(w.balance(w.john)).toEqual({ USD: '250', PKR: '-8450' });
  });

  it('refuses an offset when both balances owe the same way, or it’s more than either balance', async () => {
    const w = await world();
    w.save({ kind: 'transfer', accountId: w.usd, toPersonId: w.john, amount: '250' });
    w.save({ kind: 'transfer', accountId: w.pkr, toPersonId: w.john, amount: '1000', currency: 'PKR' }); // John owes in both
    expect(() => offsetBalances(w.db, { personId: w.john, a: { currency: 'PKR', amount: '1000' }, b: { currency: 'USD', amount: '3.6' } }, TODAY)).toThrow(
      expect.objectContaining({ code: 'same_direction' }),
    );
    w.save({ fromPersonId: w.john, amount: '2000', currency: 'PKR' }); // now you owe ₨1,000
    expect(() => offsetBalances(w.db, { personId: w.john, a: { currency: 'PKR', amount: '1001' }, b: { currency: 'USD', amount: '3.6' } }, TODAY)).toThrow(
      expect.objectContaining({ code: 'invalid_amount' }),
    );
  });

  it('tagging someone never creates an amount owed', async () => {
    const w = await world();
    w.save({ accountId: w.usd, amount: '40', referencePersonId: w.john });
    expect(w.balance(w.john)).toEqual({});
    expect(w.db.select().from(personEntries).all()).toHaveLength(0);
  });
});

describe('money back', () => {
  it('Got it: partly back, then reimbursed; never in what the person owes', async () => {
    const w = await world();
    const exp = w.save({ accountId: w.usd, amount: '24', reimbursable: true, expectedFromPersonId: w.john, date: '2026-09-18' });
    expect(Object.fromEntries(expectedBack(w.db, w.john).totals)).toEqual({ USD: '24' });
    addMoneyBack(w.db, { parentId: exp, kind: 'reimbursement', accountId: w.usd, amount: '10', date: '2026-09-25' }, TODAY);
    expect(w.row(exp).reimbursementStatus).toBe('partly_back');
    expect(Object.fromEntries(expectedBack(w.db, w.john).totals)).toEqual({ USD: '14' });
    const second = addMoneyBack(w.db, { parentId: exp, kind: 'reimbursement', accountId: w.usd, amount: '14', date: '2026-09-29' }, TODAY);
    expect(w.row(exp).reimbursementStatus).toBe('reimbursed');
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('1000');
    expect(w.balance(w.john)).toEqual({});
    expect(Object.fromEntries(expectedBack(w.db, w.john).totals)).toEqual({});

    // Deleting a Got it puts the original back to Partly back; Undo of a bulk delete re-syncs too.
    deleteTransaction(w.db, second);
    expect(w.row(exp).reimbursementStatus).toBe('partly_back');
  });

  it('money back in another currency counts as what you say in the original’s currency', async () => {
    const w = await world();
    const exp = w.save({ accountId: w.usd, amount: '120', reimbursable: true });
    expect(() => addMoneyBack(w.db, { parentId: exp, kind: 'reimbursement', accountId: w.pkr, amount: '33000', date: '2026-09-29' }, TODAY)).toThrow(
      expect.objectContaining({ code: 'invalid_amount' }),
    );
    const back = addMoneyBack(w.db, { parentId: exp, kind: 'reimbursement', accountId: w.pkr, amount: '33000', countsAs: '118.70', date: '2026-09-29' }, TODAY);
    expect(w.row(back)).toMatchObject({ countsAsAmount: '118.7', currency: 'PKR', linkType: 'reimbursement', parentId: exp });
    // Short of $120: partly back until the rest is written off.
    expect(w.row(exp).reimbursementStatus).toBe('partly_back');
    expect(accountBalance(w.db, w.pkr, TODAY)).toBe('133000');
    writeOff(w.db, exp);
    expect(w.row(exp).reimbursementStatus).toBe('written_off');
  });

  it('a refund can go to another account and isn’t added in the future', async () => {
    const w = await world();
    const exp = w.save({ accountId: w.usd, amount: '50' });
    addMoneyBack(w.db, { parentId: exp, kind: 'refund', accountId: w.usd, amount: '20', date: '2026-09-28', notes: 'Refund of Adobe' }, TODAY);
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('970');
    expect(refundableLeft(w.db, exp)).toEqual({ currency: 'USD', amount: '30' });
    expect(() => addMoneyBack(w.db, { parentId: exp, kind: 'refund', accountId: w.usd, amount: '31', date: '2026-09-29' }, TODAY)).toThrow(
      expect.objectContaining({ code: 'invalid_amount' }),
    );
    expect(() => addMoneyBack(w.db, { parentId: exp, kind: 'refund', accountId: w.usd, amount: '5', date: '2026-10-02' }, TODAY)).toThrow(
      expect.objectContaining({ code: 'invalid_target' }),
    );
  });

  it('bulk delete and Undo keep the status right', async () => {
    const w = await world();
    const exp = w.save({ accountId: w.usd, amount: '24', reimbursable: true });
    const back = addMoneyBack(w.db, { parentId: exp, kind: 'reimbursement', accountId: w.usd, amount: '24', date: '2026-09-29' }, TODAY);
    const hidden = softDeleteTransactions(w.db, [back]);
    expect(w.row(exp).reimbursementStatus).toBe('awaiting');
    restoreTransactions(w.db, hidden);
    expect(w.row(exp).reimbursementStatus).toBe('reimbursed');
  });
});

describe('Share with a person', () => {
  it('is plain text with each currency on its own line', () => {
    const text = shareSummaryText(
      'John',
      [
        { currency: 'USD', balance: '250' },
        { currency: 'EUR', balance: '40' },
        { currency: 'PKR', balance: '-8450' },
      ],
      [],
      { date: '2026-09-30', numberFormat: '1,000.00', includeLast: false },
    );
    expect(text).toBe('Hi John, here’s where we stand (Sarraf, Sep 30):\n• You owe me $250.00\n• You owe me €40.00\n• I owe you ₨8,450.00');
  });
});

describe('a refund on a split you paid (Decided Nov 8: option a)', () => {
  const dinner = (w: Awaited<ReturnType<typeof world>>) =>
    w.save({
      accountId: w.usd,
      amount: '90',
      split: {
        mode: 'equal',
        shares: [
          { personId: null, amount: '30' },
          { personId: w.john, amount: '30' },
          { personId: w.sana, amount: '30', treat: true },
        ],
      },
    });

  it('lowers only your spending; what people owe stays as split', async () => {
    const w = await world();
    const id = dinner(w);
    addMoneyBack(w.db, { parentId: id, kind: 'refund', accountId: w.usd, amount: '30', date: '2026-09-25' }, TODAY);
    expect(w.balance(w.john)).toEqual({ USD: '30' });
    expect(w.balance(w.sana)).toEqual({});
    expect(accountBalance(w.db, w.usd, TODAY)).toBe('940');
    expect(sharesKeptByRefund(w.db, id, TODAY)).toEqual([{ personId: w.john, name: 'John', share: '30', currency: 'USD', balance: '30' }]);
  });

  it('leaves a repaid share alone too', async () => {
    const w = await world();
    const id = dinner(w);
    w.save({ kind: 'transfer', fromPersonId: w.john, toAccountId: w.usd, amount: '30', date: '2026-09-22' });
    addMoneyBack(w.db, { parentId: id, kind: 'refund', accountId: w.usd, amount: '30', date: '2026-09-25' }, TODAY);
    expect(w.balance(w.john)).toEqual({ USD: '0' });
  });
});
