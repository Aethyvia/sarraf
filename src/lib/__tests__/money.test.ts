import { formatAmount } from '@/lib/money';


describe('minus sign mode', () => {
  it('always shows a minus, even on zero (money out given as a size)', () => {
    expect(formatAmount('0', 'EUR', { sign: 'minus' }).text).toBe('−€0.00');
    expect(formatAmount('1013', 'USD', { sign: 'minus' }).text).toBe('−$1,013.00');
  });
});
