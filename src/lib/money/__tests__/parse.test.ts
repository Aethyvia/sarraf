import { parseTypedAmount, toTypedText } from '..';

describe('parseTypedAmount', () => {
  it('reads plain and grouped amounts exactly', () => {
    expect(parseTypedAmount('104231.75')).toBe('104231.75');
    expect(parseTypedAmount('1,04,231.75')).toBe('104231.75');
    expect(parseTypedAmount(' 1 250.50 ')).toBe('1250.5');
    expect(parseTypedAmount("1'250")).toBe('1250');
    expect(parseTypedAmount('99999999999999999999999.999')).toBe('99999999999999999999999.999');
  });

  it('accepts a minus (hyphen or real minus) and bare decimals', () => {
    expect(parseTypedAmount('-250')).toBe('-250');
    expect(parseTypedAmount('−250')).toBe('-250');
    expect(parseTypedAmount('.5')).toBe('0.5');
    expect(parseTypedAmount('5.')).toBe('5');
  });

  it('uses a comma decimal in comma-decimal formats', () => {
    expect(parseTypedAmount('1.234,56', '1.000,00')).toBe('1234.56');
    expect(parseTypedAmount('1 234,56', '1 000,00')).toBe('1234.56');
  });

  it('returns null for anything that is not an amount', () => {
    for (const bad of ['', 'abc', '1.2.3', '--5', '1e5', '-']) expect(parseTypedAmount(bad)).toBeNull();
  });
});

describe('toTypedText', () => {
  it('round-trips through parseTypedAmount in every format', () => {
    for (const f of ['1,000.00', '1.000,00', '1 000,00', '1 000.00', "1'000.00"] as const) {
      expect(parseTypedAmount(toTypedText('276.4565', f), f)).toBe('276.4565');
      expect(parseTypedAmount(toTypedText('1000', f), f)).toBe('1000');
    }
  });
});
