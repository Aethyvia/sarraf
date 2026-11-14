import { eq } from 'drizzle-orm';

import { accounts, transactions } from '@/db/schema';
import { setup } from '@/test/factories';
import { amountFromArrived } from '../amounts';
import { accountBalances } from '../balances';
import { draftFromTransaction, prepareTransaction, saveTransaction, type ChargeDraft, type TransactionDraft } from '../transactions';

const TODAY = '2026-09-30';
jest.useFakeTimers().setSystemTime(new Date('2026-09-01T12:00:00'));

async function world() {
  const s = await setup();
  const usd = s.account('Payoneer USD', 'USD', '1250');
  const pkr = s.account('Alfalah PKR', 'PKR', '104231.75');
  const eur = s.account('Payoneer EUR', 'EUR', '340');
  const save = (draft: Partial<TransactionDraft>, id?: string) =>
    saveTransaction(s.db, { kind: 'income', date: '2026-09-28', status: 'cleared', amount: '', currency: 'USD', ...draft } as TransactionDraft, { today: TODAY, id }).id;
  const bal = (id: string) => accountBalances(s.db, TODAY).get(id);
  const row = (id: string) => s.db.select().from(transactions).where(eq(transactions.id, id)).get()!;
  const account = (id: string) => s.db.select().from(accounts).where(eq(accounts.id, id)).get()!;
  return { ...s, usd, pkr, eur, save, bal, row, account };
}

const fee = (amount: string, currency: string, extra: Partial<ChargeDraft> = {}): ChargeDraft => ({
  type: 'transfer_fee',
  amount,
  currency,
  deduction: 'already_deducted',
  ...extra,
});

describe('amountFromArrived (pure)', () => {
  it('no conversion: what arrived plus the included charges', () => {
    expect(amountFromArrived({ arrived: '980', currency: 'USD', receivingCurrency: 'USD', charges: [fee('20', 'USD')] })).toBe('1000');
  });

  it('separate charges do not change the amount before fees', () => {
    const sep: ChargeDraft = { type: 'bank_charge', amount: '5', currency: 'USD', deduction: 'charged_separately', accountId: 'x' };
    expect(amountFromArrived({ arrived: '980', currency: 'USD', receivingCurrency: 'USD', charges: [fee('20', 'USD'), sep] })).toBe('1000');
  });

  it('with a conversion: converts back at the rate, then adds the fee taken before it', () => {
    // $980.03 converted at 278 = ₨2,72,448.34; the PKR the bank shows is that minus a ₨8.34 fee taken after.
    expect(
      amountFromArrived({ arrived: '272440', currency: 'USD', receivingCurrency: 'PKR', rate: '278', charges: [fee('108.89', 'USD'), fee('8.34', 'PKR')] }),
    ).toBe('1088.92');
  });

  it('needs a rate across currencies, and something that arrived', () => {
    expect(() => amountFromArrived({ arrived: '100', currency: 'USD', receivingCurrency: 'PKR' })).toThrow('rate');
    expect(() => amountFromArrived({ arrived: '0', currency: 'USD', receivingCurrency: 'USD' })).toThrow('above zero');
  });
});

describe('saving income typed as what arrived', () => {
  it('arrives exactly as typed; the amount before fees is worked out', async () => {
    const w = await world();
    const id = w.save({ accountId: w.usd, enteredAs: 'arrived', knownAmount: '980', charges: [fee('20', 'USD')] });
    expect(w.row(id)).toMatchObject({ amount: '1000', accountAmount: '980', enteredAs: 'arrived', rate: null });
    expect(w.bal(w.usd)).toBe('2230');
  });

  it('across currencies: what arrived stays exact, and the rate you typed is kept', async () => {
    const w = await world();
    const id = w.save({ accountId: w.pkr, currency: 'USD', enteredAs: 'arrived', knownAmount: '272440', rate: '278', charges: [fee('108.89', 'USD')] });
    const r = w.row(id);
    expect(r).toMatchObject({ amount: '1088.89', accountAmount: '272440', rateMode: 'amount_known', enteredAs: 'arrived' });
    expect(r.rate).toBe('278');
    expect(w.bal(w.pkr)).toBe('376671.75');
  });

  it('a transfer between your accounts: To goes up by exactly what arrived', async () => {
    const w = await world();
    const id = w.save({ kind: 'transfer', accountId: w.usd, toAccountId: w.pkr, currency: 'USD', enteredAs: 'arrived', knownAmount: '13725', rate: '277.5', charges: [fee('1', 'USD')] });
    expect(w.row(id)).toMatchObject({ amount: '50.46', toAmount: '13725' });
    expect(w.bal(w.usd)).toBe('1199.54');
    expect(w.bal(w.pkr)).toBe('117956.75');
  });

  it('Edit opens the same way, and saving it unchanged changes nothing', async () => {
    const w = await world();
    const id = w.save({ accountId: w.pkr, currency: 'USD', enteredAs: 'arrived', knownAmount: '272440', rate: '278', charges: [fee('108.89', 'USD')] });
    const before = w.row(id);
    const draft = draftFromTransaction(w.db, id);
    expect(draft).toMatchObject({ enteredAs: 'arrived', knownAmount: '272440' });
    w.save(draft, id);
    expect(w.row(id)).toMatchObject({ amount: before.amount, accountAmount: before.accountAmount, rate: before.rate, enteredAs: 'arrived' });
  });

  it('is remembered per account, and switching back to Sent forgets it', async () => {
    const w = await world();
    const id = w.save({ accountId: w.usd, enteredAs: 'arrived', knownAmount: '980' });
    expect(w.account(w.usd).enterArrived).toBe(true);
    expect(w.account(w.pkr).enterArrived).toBe(false);
    w.save({ accountId: w.usd, amount: '50' }, id);
    expect(w.account(w.usd).enterArrived).toBe(false);
    expect(w.row(id).enteredAs).toBeNull();
  });

  it('only for money coming into your account', async () => {
    const w = await world();
    const john = w.person('John');
    expect(() => prepareTransaction(w.db, { kind: 'expense', date: TODAY, status: 'cleared', accountId: w.usd, amount: '', currency: 'USD', enteredAs: 'arrived', knownAmount: '5' })).toThrow();
    expect(() =>
      prepareTransaction(w.db, { kind: 'transfer', date: TODAY, status: 'cleared', fromPersonId: john, toAccountId: w.usd, amount: '', currency: 'USD', enteredAs: 'arrived', knownAmount: '5' }),
    ).toThrow();
  });
});
