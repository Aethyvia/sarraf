import { AmountError, computeAmounts, vsMarketPercent } from '../amounts';

describe('expense', () => {
  it('in the account currency: what left the account is the amount', () => {
    const r = computeAmounts({ kind: 'expense', amount: '1563.50', currency: 'PKR', receivingCurrency: 'PKR', rateMode: 'rate_known' });
    expect(r).toMatchObject({ converts: false, rate: null, accountAmount: '1563.5' });
  });

  it('in another currency with a known rate: USD 15.00 at 277.50 is charged ₨4,162.50', () => {
    const r = computeAmounts({ kind: 'expense', amount: '15.00', currency: 'USD', receivingCurrency: 'PKR', rateMode: 'rate_known', rate: '277.50' });
    expect(r).toMatchObject({ converts: true, rate: '277.50', accountAmount: '4162.5' });
  });

  it('in another currency with the charged amount known: works out the rate', () => {
    const r = computeAmounts({ kind: 'expense', amount: '15', currency: 'USD', receivingCurrency: 'PKR', rateMode: 'amount_known', knownAmount: '4162.50' });
    expect(r).toMatchObject({ accountAmount: '4162.5', rate: '277.5' });
  });

  it('rounds the converted amount once, half-to-even', () => {
    const r = computeAmounts({ kind: 'expense', amount: '0.01', currency: 'USD', receivingCurrency: 'PKR', rateMode: 'rate_known', rate: '0.5' });
    expect(r.accountAmount).toBe('0'); // 0.005 → 0.00 (ties to even)
  });

  it('ignores inside charges: they are a breakdown of what left the account', () => {
    const r = computeAmounts({
      kind: 'expense',
      amount: '100',
      currency: 'USD',
      receivingCurrency: 'USD',
      rateMode: 'rate_known',
      charges: [{ amount: '3', currency: 'USD', deduction: 'already_deducted' }],
    });
    expect(r.accountAmount).toBe('100');
  });

  it('asks for a rate or a charged amount when currencies differ', () => {
    const base = { kind: 'expense' as const, amount: '15', currency: 'USD', receivingCurrency: 'PKR' };
    expect(() => computeAmounts({ ...base, rateMode: 'rate_known' })).toThrow(AmountError);
    expect(() => computeAmounts({ ...base, rateMode: 'rate_known', rate: '0' })).toThrow(/rate/);
    expect(() => computeAmounts({ ...base, rateMode: 'amount_known' })).toThrow(/amount/);
  });
});

describe('income: the §11a receipt', () => {
  // Upwork $530 before deductions; $30 transfer fee inside; converted at 267 into Alfalah PKR;
  // ₨1,200 withholding tax and ₨150 bank charge on top, from Alfalah.
  const receipt = {
    kind: 'income' as const,
    amount: '530.00',
    currency: 'USD',
    receivingCurrency: 'PKR',
    receivingAccountId: 'alfalah',
    rateMode: 'rate_known' as const,
    rate: '267.00',
    charges: [
      { amount: '30.00', currency: 'USD', deduction: 'already_deducted' as const },
      { amount: '1200.00', currency: 'PKR', deduction: 'charged_separately' as const, accountId: 'alfalah' },
      { amount: '150.00', currency: 'PKR', deduction: 'charged_separately' as const, accountId: 'alfalah' },
    ],
  };

  it('arrives ₨1,33,500.00 and Alfalah goes up by ₨1,32,150.00', () => {
    expect(computeAmounts(receipt)).toMatchObject({
      afterInside: '500',
      arrives: '133500',
      accountAmount: '133500',
      netAmount: '132150',
      toAmount: null,
    });
  });

  it('marking both PKR charges Inside gives one credit of ₨1,32,150 and nothing taken twice', () => {
    const r = computeAmounts({
      ...receipt,
      charges: receipt.charges.map((c) => ({ ...c, deduction: 'already_deducted' as const, accountId: null })),
    });
    expect(r).toMatchObject({ arrives: '132150', netAmount: '132150' });
  });

  it('with the received amount known, works out the rate from what came through', () => {
    const r = computeAmounts({ ...receipt, rateMode: 'amount_known', rate: null, knownAmount: '133500' });
    expect(r).toMatchObject({ rate: '267', arrives: '133500', netAmount: '132150' });
  });

  it('converts an inside charge in a third currency at its own rate first', () => {
    const r = computeAmounts({
      kind: 'income',
      amount: '100',
      currency: 'USD',
      receivingCurrency: 'PKR',
      rateMode: 'rate_known',
      rate: '280',
      charges: [{ amount: '9', currency: 'EUR', deduction: 'already_deducted', rate: '1.10' }],
    });
    // €9 × 1.10 = $9.90 → $90.10 × 280 = ₨25,228.00
    expect(r).toMatchObject({ afterInside: '90.1', arrives: '25228' });
    expect(() =>
      computeAmounts({ ...{ kind: 'income' as const, amount: '100', currency: 'USD', receivingCurrency: 'PKR', rateMode: 'rate_known' as const, rate: '280' }, charges: [{ amount: '9', currency: 'EUR', deduction: 'already_deducted' }] }),
    ).toThrow(/rate/);
  });

  it('in one currency: what arrives is the amount less inside charges', () => {
    const r = computeAmounts({
      kind: 'income',
      amount: '50',
      currency: 'USD',
      receivingCurrency: 'USD',
      rateMode: 'rate_known',
      charges: [{ amount: '2.50', currency: 'USD', deduction: 'already_deducted' }],
    });
    expect(r).toMatchObject({ converts: false, rate: null, arrives: '47.5', accountAmount: '47.5' });
  });
});

describe('transfer', () => {
  it('the amount is what left From; To gets the converted amount', () => {
    const r = computeAmounts({
      kind: 'transfer',
      amount: '49.46',
      currency: 'USD',
      receivingCurrency: 'PKR',
      receivingAccountId: 'alfalah',
      rateMode: 'rate_known',
      rate: '277.50',
      charges: [{ amount: '150', currency: 'PKR', deduction: 'charged_separately', accountId: 'alfalah' }],
    });
    expect(r).toMatchObject({ accountAmount: '49.46', toAmount: '13725.15', netAmount: '13575.15' });
  });

  it('a fee Payoneer took out of the amount is inside', () => {
    const r = computeAmounts({
      kind: 'transfer',
      amount: '530',
      currency: 'USD',
      receivingCurrency: 'PKR',
      rateMode: 'amount_known',
      knownAmount: '133500',
      charges: [{ amount: '30', currency: 'USD', deduction: 'already_deducted' }],
    });
    expect(r).toMatchObject({ accountAmount: '530', toAmount: '133500', rate: '267' });
  });
});

describe('vs market', () => {
  it('shows the gap to one decimal', () => {
    expect(vsMarketPercent('277.50', '278.10')).toBe('-0.2');
    expect(vsMarketPercent('267', '267.40')).toBe('-0.1');
    expect(vsMarketPercent(null, '1')).toBeNull();
  });
});
