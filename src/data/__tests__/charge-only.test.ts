import { accountBalance } from '../balances';
import { saveTransaction, type TransactionDraft } from '../transactions';
import { setup } from '@/test/factories';

const TODAY = '2026-09-30';

describe('a charge on its own (owner, Nov 14): amount 0, only separate charges', () => {
  const base = async () => {
    const s = await setup();
    const pkr = s.account('Alfalah PKR', 'PKR');
    s.tx({ kind: 'opening_balance', accountId: pkr, amount: '1000', accountAmount: '1000', date: '2026-09-01' });
    const save = (d: Partial<TransactionDraft>) =>
      saveTransaction(s.db, { kind: 'expense', date: '2026-09-10', status: 'cleared', accountId: pkr, amount: '0', currency: 'PKR', ...d } as TransactionDraft, { today: TODAY });
    return { s, pkr, save };
  };

  it('saves, and only the charge leaves the account', async () => {
    const { s, pkr, save } = await base();
    save({ charges: [{ type: 'bank_charge', amount: '150', currency: 'PKR', deduction: 'charged_separately', accountId: pkr }] });
    expect(accountBalance(s.db, pkr, TODAY)).toBe('850');
  });

  it('works across currencies without asking for a rate', async () => {
    const { s, pkr, save } = await base();
    save({ currency: 'USD', charges: [{ type: 'bank_charge', amount: '150', currency: 'PKR', deduction: 'charged_separately', accountId: pkr }] });
    expect(accountBalance(s.db, pkr, TODAY)).toBe('850');
  });

  it('0 with no charges, or with an included charge, is refused', async () => {
    const { pkr, save } = await base();
    expect(() => save({})).toThrow();
    expect(() =>
      save({
        charges: [
          { type: 'bank_charge', amount: '150', currency: 'PKR', deduction: 'charged_separately', accountId: pkr },
          { type: 'transfer_fee', amount: '5', currency: 'PKR', deduction: 'already_deducted' },
        ],
      }),
    ).toThrow();
  });
});
