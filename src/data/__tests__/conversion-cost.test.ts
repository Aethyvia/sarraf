import { conversionCost } from '../conversion-cost';
import { storeRates } from '../rates';
import { saveTransaction, type TransactionDraft } from '../transactions';
import { setup } from '@/test/factories';

const TODAY = '2026-09-30';

describe('what converting cost you', () => {
  it('adds the fees entered and the gap to the market rate saved at entry, per route, in PKR', async () => {
    const s = await setup();
    const usd = s.account('Payoneer USD', 'USD');
    const pkr = s.account('Alfalah PKR', 'PKR');
    s.tx({ kind: 'opening_balance', accountId: usd, amount: '1000', accountAmount: '1000', date: '2026-09-01' });
    storeRates(s.db, { PKR: '280' }, '2026-09-30T06:00:00Z');
    const save = (d: Partial<TransactionDraft>, market: string) =>
      saveTransaction(s.db, { kind: 'transfer', date: '2026-09-10', status: 'cleared', ...d } as TransactionDraft, {
        today: TODAY,
        marketRate: { rate: market, fetchedAt: '2026-09-10T06:00:00Z' },
      });
    // $100 at 278 when the market was 280: a ₨200 gap, plus a ₨150 bank charge.
    save(
      {
        accountId: usd,
        toAccountId: pkr,
        amount: '100',
        currency: 'USD',
        rate: '278',
        charges: [{ type: 'bank_charge', amount: '150', currency: 'PKR', deduction: 'charged_separately', accountId: pkr }],
      },
      '280',
    );
    // Another $50 at 279 (market 280): ₨50 gap, and a $2 fee inside ($2 = ₨560 at today's 280).
    save(
      { accountId: usd, toAccountId: pkr, amount: '50', currency: 'USD', rate: '279', charges: [{ type: 'transfer_fee', amount: '2', currency: 'USD', deduction: 'already_deducted' }] },
      '280',
    );
    const c = conversionCost(s.db, { from: '2026-09-01', to: TODAY, currency: 'PKR' });
    expect(c.routes).toEqual([{ key: expect.any(String), label: 'Payoneer USD → Alfalah PKR', count: 2, fees: '710', rateGap: '248', total: '958' }]);
    expect([c.fees, c.rateGap, c.total]).toEqual(['710', '248', '958']);
    // Moved: $100 + $48 converted = ₨41,440 at today's rate.
    expect(c.moved).toBe('41440');
  });
});
