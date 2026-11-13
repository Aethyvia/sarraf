import { buildReceipt, type ReceiptRow } from '../receipt';

const payoneer = { id: 'p', name: 'Payoneer USD', currency: 'USD' };
const alfalah = { id: 'a', name: 'Alfalah PKR', currency: 'PKR' };
const cash = { id: 'c', name: 'Cash PKR', currency: 'PKR' };
const show = (rows: ReceiptRow[]) => rows.map((r) => [r.kind, r.account?.name ?? '', `${r.sign ?? ''}${r.value ?? ''}`, r.bold ? 'bold' : '']);

describe('receipt (statement style, owner Nov 13)', () => {
  it('expense with a charge separately from the same account: Left (total) first, then Base, then +charge', () => {
    const rows = buildReceipt({
      kind: 'expense',
      from: payoneer,
      amount: '1500',
      currency: 'USD',
      accountAmount: '1500',
      charges: [{ key: 'f', deduction: 'charged_separately', accountId: 'p', amount: '15', currency: 'USD' }],
    });
    expect(show(rows)).toEqual([
      ['left', 'Payoneer USD', '1515', 'bold'],
      ['base', '', '1500', ''],
      ['charge', '', '+15', ''],
    ]);
  });

  it('income with a fee taken before it arrived: Base, −fee, Arrives (bold, last)', () => {
    const rows = buildReceipt({
      kind: 'income',
      to: payoneer,
      amount: '1000',
      currency: 'USD',
      arrives: '980',
      charges: [{ key: 'f', deduction: 'already_deducted', amount: '20', currency: 'USD' }],
    });
    expect(show(rows)).toEqual([
      ['base', '', '1000', ''],
      ['charge', '', '-20', ''],
      ['arrives', 'Payoneer USD', '980', 'bold'],
    ]);
  });

  it('income with a bank charge separately: Arrives is what landed, then −charge, then bold "went up by"', () => {
    const rows = buildReceipt({
      kind: 'income',
      to: alfalah,
      amount: '500',
      currency: 'USD',
      arrives: '139000',
      conversion: { amount: '500', rate: '278', from: 'USD', to: 'PKR' },
      charges: [{ key: 'b', deduction: 'charged_separately', accountId: 'a', amount: '150', currency: 'PKR' }],
    });
    expect(show(rows)).toEqual([
      ['base', '', '500', ''],
      ['converted', '', '', ''],
      ['arrives', 'Alfalah PKR', '139000', ''],
      ['charge', '', '-150', ''],
      ['wentUp', 'Alfalah PKR', '138850', 'bold'],
    ]);
  });

  it('transfer USD→PKR: Left (with its separate fee), Base, +fee, −fee before it arrived, conversion, Arrives, −charge, went up by', () => {
    const rows = buildReceipt({
      kind: 'transfer',
      from: payoneer,
      to: alfalah,
      amount: '500',
      currency: 'USD',
      accountAmount: '500',
      arrives: '136220',
      conversion: { amount: '490', rate: '278', from: 'USD', to: 'PKR' },
      charges: [
        { key: 'w', deduction: 'already_deducted', amount: '10', currency: 'USD' },
        { key: 'p', deduction: 'charged_separately', accountId: 'p', amount: '3', currency: 'USD' },
        { key: 'b', deduction: 'charged_separately', accountId: 'a', amount: '150', currency: 'PKR' },
      ],
    });
    expect(show(rows)).toEqual([
      ['left', 'Payoneer USD', '503', 'bold'],
      ['base', '', '500', ''],
      ['charge', '', '+3', ''],
      ['charge', '', '-10', ''],
      ['converted', '', '', ''],
      ['arrives', 'Alfalah PKR', '136220', ''],
      ['charge', '', '-150', ''],
      ['wentUp', 'Alfalah PKR', '136070', 'bold'],
    ]);
  });

  it('a charge from another account in another currency is its own line, never added into a total', () => {
    const rows = buildReceipt({
      kind: 'income',
      to: payoneer,
      amount: '500',
      currency: 'USD',
      arrives: '500',
      charges: [{ key: 'x', deduction: 'charged_separately', accountId: cash.id, amount: '150', currency: 'PKR' }],
    });
    expect(show(rows)).toEqual([
      ['base', '', '500', ''],
      ['arrives', 'Payoneer USD', '500', 'bold'],
      ['charge', '', '150', ''],
    ]);
  });
});
