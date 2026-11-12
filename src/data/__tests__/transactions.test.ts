import { eq } from 'drizzle-orm';

import { personEntries, transactionCharges, transactions } from '@/db/schema';
import { accountBalances } from '../balances';
import { cancelTransaction, confirmLabel, confirmTransaction, markInTransit, needsReview } from '../review';
import { attachmentsOf } from '../attachments';
import { draftFromTransaction, saveTransaction, type TransactionDraft } from '../transactions';
import { setup } from '@/test/factories';

const TODAY = '2026-09-30';

async function world() {
  const s = await setup();
  const usd = s.account('Payoneer USD', 'USD', '1250');
  const pkr = s.account('Alfalah PKR', 'PKR', '104231.75');
  const cash = s.account('Cash PKR', 'PKR', '2500');
  const groceries = s.category('Groceries');
  const consulting = s.category('Consulting income', 'income');
  const john = s.person('John');
  const save = (draft: Partial<TransactionDraft>, opts: Parameters<typeof saveTransaction>[2] = {}) =>
    saveTransaction(s.db, { kind: 'expense', date: '2026-09-28', status: 'cleared', amount: '10', currency: 'USD', ...draft } as TransactionDraft, { today: TODAY, ...opts }).id;
  const bal = (id: string) => accountBalances(s.db, TODAY).get(id);
  const row = (id: string) => s.db.select().from(transactions).where(eq(transactions.id, id)).get()!;
  return { ...s, usd, pkr, cash, groceries, consulting, john, save, bal, row };
}

// Opening balances are dated the day the account is created; count everything up to then.
jest.useFakeTimers().setSystemTime(new Date('2026-09-01T12:00:00'));

describe('saving an expense', () => {
  it('in the account currency lowers the balance', async () => {
    const w = await world();
    w.save({ accountId: w.pkr, amount: '4200', currency: 'PKR', categoryId: w.groceries, ledgerId: w.personal });
    expect(w.bal(w.pkr)).toBe('100031.75');
  });

  it('in another currency stores the rate got, what was charged, and the market rate at entry', async () => {
    const w = await world();
    const id = w.save(
      { accountId: w.pkr, amount: '15.00', currency: 'USD', rate: '277.50', rateMode: 'rate_known' },
      { marketRate: { rate: '278.10', fetchedAt: '2026-09-28T08:00:00Z' } },
    );
    expect(w.row(id)).toMatchObject({ amount: '15', currency: 'USD', rate: '277.50', rateMode: 'rate_known', accountAmount: '4162.5', marketRateAtEntry: '278.10' });
    expect(w.bal(w.pkr)).toBe('100069.25');
  });

  it('"Paid from → Person": no account moves, and you now owe them', async () => {
    const w = await world();
    const id = w.save({ fromPersonId: w.john, amount: '521.17', currency: 'PKR' });
    expect(w.row(id)).toMatchObject({ accountId: null, paidByPersonId: w.john, accountAmount: null });
    expect(w.db.select().from(personEntries).all()).toEqual([
      expect.objectContaining({ personId: w.john, source: 'paid_by_person', amount: '-521.17', currency: 'PKR', transactionId: id }),
    ]);
    expect(w.bal(w.pkr)).toBe('104231.75');
  });

  it('keeps the reimbursable switch and who it is expected back from, outside what people owe', async () => {
    const w = await world();
    const id = w.save({ accountId: w.usd, amount: '24', reimbursable: true, expectedFromPersonId: w.john });
    expect(w.row(id)).toMatchObject({ reimbursable: true, expectedFromPersonId: w.john, reimbursementStatus: 'awaiting' });
    expect(w.db.select().from(personEntries).all()).toHaveLength(0);
  });

  it('refuses a category of the other kind, a zero amount, and two payers', async () => {
    const w = await world();
    expect(() => w.save({ accountId: w.usd, categoryId: w.consulting })).toThrow(/other kind/);
    expect(() => w.save({ accountId: w.usd, amount: '0' })).toThrow(/above zero/);
    expect(() => w.save({ accountId: w.usd, fromPersonId: w.john })).toThrow(/paid from/);
    expect(w.db.select().from(transactions).all().filter((t) => t.kind === 'expense')).toHaveLength(0);
  });
});

describe('saving income with charges (the §11a receipt)', () => {
  it('Alfalah goes up by ₨1,32,150.00; tax and fees are stored as charges', async () => {
    const w = await world();
    const id = w.save({
      kind: 'income',
      accountId: w.pkr,
      categoryId: w.consulting,
      amount: '530.00',
      currency: 'USD',
      rate: '267.00',
      charges: [
        { type: 'transfer_fee', amount: '30', currency: 'USD', deduction: 'already_deducted' },
        { type: 'withholding_tax', amount: '1200', currency: 'PKR', deduction: 'charged_separately', accountId: w.pkr },
        { type: 'bank_charge', amount: '150', currency: 'PKR', deduction: 'charged_separately', accountId: w.pkr },
      ],
    });
    expect(w.row(id)).toMatchObject({ accountAmount: '133500', netAmount: '132150' });
    expect(w.bal(w.pkr)).toBe('236381.75'); // 1,04,231.75 + 1,32,150
    const charges = w.db.select().from(transactionCharges).all();
    expect(charges.find((c) => c.type === 'withholding_tax')).toMatchObject({ isTax: true, accountId: w.pkr, rate: null });
    expect(charges.find((c) => c.type === 'transfer_fee')).toMatchObject({ isTax: false, accountId: null });
  });

  it('an on-top charge must be in its account’s currency', async () => {
    const w = await world();
    expect(() =>
      w.save({ kind: 'income', accountId: w.pkr, amount: '10', currency: 'PKR', charges: [{ type: 'bank_charge', amount: '1', currency: 'USD', deduction: 'charged_separately', accountId: w.pkr }] }),
    ).toThrow(/currency/);
  });
});

describe('transfers', () => {
  it('between your accounts: From in its own currency, To gets what arrived', async () => {
    const w = await world();
    const id = w.save({ kind: 'transfer', accountId: w.usd, toAccountId: w.pkr, amount: '49.46', currency: 'PKR', rate: '277.50', status: 'in_transit' });
    // The draft's currency is ignored: a transfer is in From's currency.
    expect(w.row(id)).toMatchObject({ currency: 'USD', accountAmount: '49.46', toAmount: '13725.15', categoryId: null });
    expect([w.bal(w.usd), w.bal(w.pkr)]).toEqual(['1200.54', '104231.75']);
  });

  it('lending to a person: leaves the account and they owe you', async () => {
    const w = await world();
    const id = w.save({ kind: 'transfer', accountId: w.usd, toPersonId: w.john, amount: '250' });
    expect(w.row(id)).toMatchObject({ transferPersonId: w.john, toAccountId: null, toAmount: null });
    expect(w.db.select({ a: personEntries.amount, c: personEntries.currency }).from(personEntries).all()).toEqual([{ a: '250', c: 'USD' }]);
    expect(w.bal(w.usd)).toBe('1000');
  });

  it('being paid back by a person: arrives in your account and lowers what they owe', async () => {
    const w = await world();
    w.save({ kind: 'transfer', fromPersonId: w.john, toAccountId: w.pkr, amount: '8450', currency: 'USD' });
    expect(w.db.select({ a: personEntries.amount, c: personEntries.currency }).from(personEntries).all()).toEqual([{ a: '-8450', c: 'PKR' }]);
    expect(w.bal(w.pkr)).toBe('112681.75');
  });

  it('refuses the same account twice, and person to person', async () => {
    const w = await world();
    expect(() => w.save({ kind: 'transfer', accountId: w.usd, toAccountId: w.usd })).toThrow(/same account/);
    expect(() => w.save({ kind: 'transfer', fromPersonId: w.john, toPersonId: w.john })).toThrow();
  });
});

describe('Upcoming and Needs review', () => {
  it('a future-dated item is Upcoming: not in balances, waits in Needs review', async () => {
    const w = await world();
    const id = w.save({ accountId: w.pkr, amount: '12500', currency: 'PKR', date: '2026-10-26' });
    expect(w.row(id).scheduled).toBe(true);
    expect(w.bal(w.pkr)).toBe('104231.75');
    const r = needsReview(w.db, TODAY);
    expect(r.upcoming.map((t) => t.id)).toEqual([id]);
    expect([r.toConfirm, r.upcomingCount]).toEqual([0, 1]);
    expect(() => confirmTransaction(w.db, id, TODAY, TODAY)).toThrow(/due/);

    // On its date it gets a button and joins the badge; confirming makes it count.
    const r2 = needsReview(w.db, '2026-10-26');
    expect([r2.toConfirm, r2.upcomingCount]).toEqual([1, 0]);
    confirmTransaction(w.db, id, '2026-10-26', '2026-10-26');
    expect(w.row(id)).toMatchObject({ scheduled: false, status: 'cleared', date: '2026-10-26' });
    expect(accountBalances(w.db, '2026-10-26').get(w.pkr)).toBe('91731.75');
  });

  it('Pending counts nowhere until Received, on today or the original date', async () => {
    const w = await world();
    const id = w.save({ kind: 'income', accountId: w.usd, amount: '500', status: 'pending', expectedDate: '2026-10-14', date: '2026-09-20' });
    expect(w.row(id).expectedDate).toBe('2026-10-14');
    expect(w.bal(w.usd)).toBe('1250');
    expect(needsReview(w.db, TODAY).pending.map((t) => t.id)).toEqual([id]);
    expect(() => confirmTransaction(w.db, id, '2026-10-01', TODAY)).toThrow(/earlier/);
    confirmTransaction(w.db, id, '2026-09-20', TODAY);
    expect(w.row(id)).toMatchObject({ status: 'cleared', date: '2026-09-20', expectedDate: null });
    expect(w.bal(w.usd)).toBe('1750');
  });

  it('Pending can move to In transit; Cancelled leaves it in history but out of balances', async () => {
    const w = await world();
    const id = w.save({ kind: 'transfer', accountId: w.usd, toAccountId: w.pkr, amount: '100', rate: '278', status: 'pending' });
    markInTransit(w.db, id);
    expect(w.bal(w.usd)).toBe('1150');
    expect(needsReview(w.db, TODAY).inTransit).toHaveLength(1);
    cancelTransaction(w.db, id);
    expect(w.row(id).status).toBe('cancelled');
    expect(w.bal(w.usd)).toBe('1250');
    expect(needsReview(w.db, TODAY).inTransit).toHaveLength(0);
  });

  it('lists reimbursables waiting for money back, outside the badge', async () => {
    const w = await world();
    w.save({ accountId: w.usd, amount: '24', reimbursable: true });
    const r = needsReview(w.db, TODAY);
    expect([r.waitingBack.length, r.toConfirm]).toEqual([1, 0]);
  });
});

describe('editing', () => {
  it('loads a saved transaction back into a draft and replaces it, charges and entries included', async () => {
    const w = await world();
    const id = w.save({ kind: 'transfer', accountId: w.usd, toPersonId: w.john, amount: '250', charges: [{ type: 'transfer_fee', amount: '2', currency: 'USD', deduction: 'already_deducted' }] });
    const draft = draftFromTransaction(w.db, id);
    expect(draft).toMatchObject({ kind: 'transfer', accountId: w.usd, toPersonId: w.john, amount: '250' });
    expect(draft.charges).toHaveLength(1);

    saveTransaction(w.db, { ...draft, amount: '200', charges: [] }, { id, today: TODAY });
    expect(w.row(id).amount).toBe('200');
    expect(w.db.select().from(transactionCharges).all()).toHaveLength(0);
    expect(w.db.select({ a: personEntries.amount }).from(personEntries).all()).toEqual([{ a: '200' }]);
  });
});

describe('the confirm button', () => {
  const t = (kind: 'expense' | 'income' | 'transfer', extra: Partial<{ recurringId: string; autoAdded: boolean; scheduled: boolean }> = {}) =>
    confirmLabel({ kind, recurringId: null, autoAdded: false, scheduled: false, ...extra });
  it('is Paid for every expense (pending ones too, Owner Nov 12), Received for income and transfers', () => {
    expect(t('expense', { autoAdded: true, recurringId: 'r' })).toBe('paid');
    expect(t('expense', { scheduled: true })).toBe('paid');
    expect(t('expense')).toBe('paid');
    expect(t('income', { autoAdded: true })).toBe('received');
    expect(t('transfer')).toBe('received');
  });
});

describe('attachments', () => {
  it('are added and removed with the transaction’s save, and go when it is deleted', async () => {
    const w = await world();
    const file = (n: number) => ({ filePath: `attachments/${n}.jpg`, mimeType: 'image/jpeg', sizeBytes: 1000 * n });
    const id = w.save({ accountId: w.usd }, { attachments: { add: [file(1), file(2)] } });
    const rows = attachmentsOf(w.db, { transactionId: id });
    expect(rows.map((r) => r.filePath)).toEqual(['attachments/1.jpg', 'attachments/2.jpg']);

    const { removedAttachmentPaths } = saveTransaction(w.db, draftFromTransaction(w.db, id), {
      id,
      today: TODAY,
      attachments: { add: [file(3)], removeIds: [rows[0].id] },
    });
    expect(removedAttachmentPaths).toEqual(['attachments/1.jpg']);
    expect(attachmentsOf(w.db, { transactionId: id }).map((r) => r.filePath).sort()).toEqual(['attachments/2.jpg', 'attachments/3.jpg']);
  });
});
