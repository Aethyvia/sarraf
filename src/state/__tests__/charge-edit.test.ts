import type { ChargeDraft } from '@/data/transactions';
import {
  chargeFromEdit,
  commitCharges,
  editCharge,
  liveCharges,
  needsRate,
  newChargeEdit,
  pressChargeKey,
  withAccount,
  withDeduction,
  withType,
  type ChargeContext,
  type ChargeEdit,
} from '../charge-edit';
import type { CalcKey } from '@/lib/calc';

// Income of $530.00 into Alfalah PKR (the sample data).
const ctx: ChargeContext = {
  mainCurrency: 'USD',
  receivingCurrency: 'PKR',
  defaultAccountId: 'alfalah',
  accountCurrency: (id) => ({ alfalah: 'PKR', payoneer: 'USD', cashAed: 'AED' })[id],
};
const type = (e: ChargeEdit, keys: string) => [...keys].reduce((x, k) => pressChargeKey(x, k as CalcKey), e);

const fee: ChargeDraft = { type: 'transfer_fee', amount: '30', currency: 'USD', deduction: 'already_deducted', accountId: null, isTax: false, label: null, rate: null, rateMode: null };

describe('starting a charge', () => {
  it('starts fees inside the amount, in its currency', () => {
    expect(newChargeEdit('transfer_fee', ctx)).toMatchObject({ index: null, deduction: 'already_deducted', currency: 'USD', isTax: false });
  });

  it('starts taxes and bank charges on top, from the receiving account, in its currency', () => {
    expect(newChargeEdit('bank_charge', ctx)).toMatchObject({ deduction: 'charged_separately', accountId: 'alfalah', currency: 'PKR' });
    expect(newChargeEdit('withholding_tax', ctx)).toMatchObject({ deduction: 'charged_separately', isTax: true });
  });

  it('moves a new, empty charge to its type’s place; a charge being edited stays where the user put it', () => {
    const fresh = withType(newChargeEdit('transfer_fee', ctx), 'bank_charge', ctx);
    expect(fresh).toMatchObject({ deduction: 'charged_separately', currency: 'PKR' });
    const edited = withType(editCharge(fee, 0), 'bank_charge', ctx);
    expect(edited).toMatchObject({ deduction: 'already_deducted', currency: 'USD' });
  });

  it('keeps tax on for withholding tax, and a custom type keeps its name', () => {
    const e = withType(newChargeEdit('transfer_fee', ctx), 'withholding_tax', ctx);
    expect(e.isTax).toBe(true);
    expect(withType(e, 'custom', ctx, 'Upwork fee')).toMatchObject({ type: 'custom', label: 'Upwork fee', isTax: false });
  });
});

describe('typing the amount with the keypad', () => {
  it('works out sums, and rounds to the currency', () => {
    const e = type(newChargeEdit('platform_fee', ctx), '530×2.5÷100');
    expect(chargeFromEdit(e, ctx)?.amount).toBe('13.25');
    const pkr = type(newChargeEdit('bank_charge', ctx), '100÷3');
    expect(chargeFromEdit(pkr, ctx)?.amount).toBe('33.33');
  });

  it('deletes and clears', () => {
    const e = type(newChargeEdit('transfer_fee', ctx), '305');
    expect(pressChargeKey(e, 'back').expression).toBe('30');
    expect(pressChargeKey(e, 'clear').expression).toBe('');
  });

  it('counts nothing while the amount is empty, zero or unfinished', () => {
    const e = newChargeEdit('transfer_fee', ctx);
    expect(chargeFromEdit(e, ctx)).toBeNull();
    expect(chargeFromEdit(type(e, '0'), ctx)).toBeNull();
    expect(chargeFromEdit(type(e, '30+'), ctx)?.amount).toBe('30');
  });
});

describe('inside or on top', () => {
  it('on top takes the paying account’s currency and never a rate; back inside returns to the main currency', () => {
    let e = type(newChargeEdit('transfer_fee', ctx), '150');
    e = withDeduction(e, 'charged_separately', ctx);
    expect(e).toMatchObject({ currency: 'PKR', accountId: 'alfalah', rate: null });
    e = withAccount(e, 'cashAed', ctx);
    expect(e.currency).toBe('AED');
    expect(chargeFromEdit(e, ctx)).toMatchObject({ accountId: 'cashAed', currency: 'AED', deduction: 'charged_separately' });
    expect(withDeduction(e, 'already_deducted', ctx).currency).toBe('USD');
  });

  it('asks for a rate only for an inside charge in a third currency', () => {
    const e = { ...type(newChargeEdit('transfer_fee', ctx), '20'), currency: 'EUR' };
    expect(needsRate(e, ctx)).toBe(true);
    expect(chargeFromEdit(e, ctx)).toBeNull();
    expect(chargeFromEdit({ ...e, rate: '1.08' }, ctx)).toMatchObject({ currency: 'EUR', rate: '1.08', rateMode: 'rate_known' });
    expect(needsRate({ ...e, currency: 'PKR' }, ctx)).toBe(false);
  });
});

describe('the receipt while typing, and keeping changes', () => {
  it('counts a finished edit in place, and leaves out an unfinished one', () => {
    const editing = type(pressChargeKey(editCharge(fee, 0), 'clear'), '25');
    expect(liveCharges([fee], editing, ctx).map((c) => c.amount)).toEqual(['25']);
    expect(liveCharges([fee], pressChargeKey(editing, 'clear'), ctx)).toEqual([]);
    expect(liveCharges([fee], type(newChargeEdit('bank_charge', ctx), '150'), ctx)).toHaveLength(2);
  });

  it('never loses a saved charge whose amount was cleared and left; drops an unfinished new one', () => {
    const cleared = pressChargeKey(editCharge(fee, 0), 'clear');
    expect(commitCharges([fee], cleared, ctx)).toEqual([fee]);
    expect(commitCharges([fee], newChargeEdit('bank_charge', ctx), ctx)).toEqual([fee]);
    const changed = type(cleared, '45');
    expect(commitCharges([fee], changed, ctx)[0].amount).toBe('45');
  });
});

describe('the rate on the same keypad (Owner, Nov 12)', () => {
  it('types the rate when it is the target, and counts it once it works out', () => {
    let e: ChargeEdit = { ...newChargeEdit('transfer_fee', ctx), currency: 'EUR', expression: '20', target: 'rate' };
    for (const k of ['1', '.', '0', '8'] as const) e = pressChargeKey(e, k);
    expect(e).toMatchObject({ rate: '1.08', expression: '20' });
    expect(chargeFromEdit(e, ctx)).toMatchObject({ currency: 'EUR', amount: '20', rate: '1.08' });
    expect(chargeFromEdit({ ...e, rate: '0' }, ctx)).toBeNull();
    expect(pressChargeKey({ ...e, target: 'amount' }, '5').expression).toBe('205');
  });
});

