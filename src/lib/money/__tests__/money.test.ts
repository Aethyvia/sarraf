import {
  add,
  compare,
  convert,
  dec,
  formatAmount,
  formatExact,
  formatTyped,
  getCurrency,
  isDecimalString,
  MINUS,
  rateFromAmounts,
  roundToMinor,
  sub,
  toDecimalString,
} from '..';

const NBSP = ' ';
const text = (...args: Parameters<typeof formatAmount>) => formatAmount(...args).text;

describe('exact decimals', () => {
  it('adds without float error', () => {
    expect(add('0.1', '0.2')).toBe('0.3');
    expect(sub('1250', '1013.00')).toBe('237');
  });

  it('has no upper limit', () => {
    expect(add('99999999999999999999999999999999.99', '0.01')).toBe('100000000000000000000000000000000');
  });

  it('never stores exponent notation or -0', () => {
    expect(toDecimalString(dec('0.0000001'))).toBe('0.0000001');
    expect(toDecimalString(dec('1000000000000000000000000'))).toBe('1000000000000000000000000');
    expect(sub('5', '5')).toBe('0');
    expect(toDecimalString(dec('-0'))).toBe('0');
  });

  it('rejects anything that is not a plain decimal string', () => {
    expect(isDecimalString('104231.75')).toBe(true);
    expect(isDecimalString('-30')).toBe(true);
    for (const bad of ['', '1e5', '1,000', '.5', '5.', 'NaN', 'Infinity', ' 5']) {
      expect(isDecimalString(bad)).toBe(false);
      expect(() => dec(bad)).toThrow();
    }
  });

  it('compares', () => {
    expect(compare('10.00', '10')).toBe(0);
    expect(compare('-1', '0')).toBe(-1);
  });
});

describe('rounding to minor units, half-to-even', () => {
  it('uses ISO 4217 minor units', () => {
    expect(getCurrency('USD').minorUnits).toBe(2);
    expect(getCurrency('JPY').minorUnits).toBe(0);
    expect(getCurrency('KWD').minorUnits).toBe(3);
  });

  it('rounds ties to even', () => {
    expect(roundToMinor('2.345', 'USD')).toBe('2.34');
    expect(roundToMinor('2.355', 'USD')).toBe('2.36');
    expect(roundToMinor('-2.345', 'USD')).toBe('-2.34');
    expect(roundToMinor('2.5', 'JPY')).toBe('2');
    expect(roundToMinor('3.5', 'JPY')).toBe('4');
    expect(roundToMinor('1.0005', 'KWD')).toBe('1');
    expect(roundToMinor('1.0015', 'KWD')).toBe('1.002');
  });

  it('rounds a non-tie normally', () => {
    expect(roundToMinor('2.3451', 'USD')).toBe('2.35');
  });

  it('converts and rounds once, in the target currency', () => {
    // Sample transfer: $49.46 at 277.50 → ₨13,725.15
    expect(convert('49.46', '277.50', 'PKR')).toBe('13725.15');
    // $500 at 267 → ₨1,33,500
    expect(convert('500', '267', 'PKR')).toBe('133500');
    // Keeps full precision until the single rounding step
    expect(convert('0.015', '1', 'USD')).toBe('0.02');
    expect(convert('0.025', '1', 'USD')).toBe('0.02');
  });

  it('works out a rate from two amounts', () => {
    expect(rateFromAmounts('49.46', '13725.00')).toBe('277.4969672463');
    expect(rateFromAmounts('100', '27810')).toBe('278.1');
    expect(() => rateFromAmounts('0', '5')).toThrow();
  });
});

describe('formatting', () => {
  it('uses lakh grouping for PKR', () => {
    expect(text('104231.75', 'PKR')).toBe('₨1,04,231.75');
    expect(text('133500', 'PKR')).toBe('₨1,33,500.00');
    expect(text('1043000', 'PKR')).toBe('₨10,43,000.00');
    expect(text('125480231.75', 'PKR')).toBe('₨12,54,80,231.75');
    expect(text('999', 'PKR')).toBe('₨999.00');
  });

  it('keeps PKR on lakh grouping whatever number format is chosen', () => {
    expect(text('104231.75', 'PKR', { numberFormat: '1.000,00' })).toBe('₨1,04,231.75');
  });

  it('applies each number format to other currencies', () => {
    expect(text('1250', 'USD')).toBe('$1,250.00');
    expect(text('1234567.8', 'EUR', { numberFormat: '1.000,00' })).toBe('€1.234.567,80');
    expect(text('1234567.8', 'EUR', { numberFormat: '1 000,00' })).toBe(`€1${NBSP}234${NBSP}567,80`);
    expect(text('1234567.8', 'EUR', { numberFormat: '1 000.00' })).toBe(`€1${NBSP}234${NBSP}567.80`);
    expect(text('1234567.8', 'EUR', { numberFormat: "1'000.00" })).toBe("€1'234'567.80");
  });

  it('shows the code when there is no clear symbol', () => {
    expect(text('1200', 'AED')).toBe(`AED${NBSP}1,200.00`);
    expect(text('450', 'SAR')).toBe(`SAR${NBSP}450.00`);
  });

  it('pads to minor units and never rounds extra stored digits away', () => {
    expect(text('5', 'JPY')).toBe('¥5');
    expect(text('1.5', 'KWD')).toBe(`KWD${NBSP}1.500`);
    expect(text('15.005', 'USD')).toBe('$15.005');
  });

  it('signs amounts with a real minus, before the symbol', () => {
    expect(text('-1013', 'USD')).toBe(`${MINUS}$1,013.00`);
    expect(text('-310', 'AED')).toBe(`${MINUS}AED${NBSP}310.00`);
    expect(text('1650', 'USD', { sign: 'always' })).toBe('+$1,650.00');
    expect(text('0', 'PKR', { sign: 'always' })).toBe('+₨0.00');
    expect(text('-0', 'USD')).toBe('$0.00');
    expect(text('-5', 'USD', { sign: 'never' })).toBe('$5.00');
  });

  it('can leave the currency off', () => {
    expect(text('125480231.75', 'PKR', { showCurrency: false })).toBe('12,54,80,231.75');
  });
});

describe('compact numbers (M / B / T)', () => {
  const short = (value: string, currency: string, numberFormat?: Parameters<typeof formatAmount>[2]) =>
    formatAmount(value, currency, { compact: true, ...numberFormat });

  it('matches the Number formatting rules board', () => {
    expect(short('850000', 'USD')).toEqual({ text: '$850,000.00', isCompact: false });
    expect(short('1000000', 'USD')).toEqual({ text: '$1M', isCompact: true });
    expect(short('1980000', 'USD').text).toBe('$1.98M');
    expect(short('3400000', 'USD').text).toBe('$3.4M');
    expect(short('1999999', 'PKR').text).toBe('₨1.99M');
    expect(short('125480231.75', 'PKR').text).toBe('₨125.48M');
    expect(short('-12450521170', 'PKR').text).toBe(`${MINUS}₨12.45B`);
    expect(short('2300000000000', 'USD').text).toBe('$2.3T');
    expect(short('4560000000000000', 'USD').text).toBe('$4,560T');
    expect(formatAmount('1250340000', 'USD', { compact: true, sign: 'always' }).text).toBe('+$1.25B');
  });

  it('never uses K', () => {
    expect(short('999999.99', 'USD').text).toBe('$999,999.99');
  });

  it('cuts instead of rounding, for negatives too', () => {
    expect(short('-1999999', 'USD').text).toBe(`${MINUS}$1.99M`);
  });

  it('uses the chosen decimal separator', () => {
    expect(short('1980000', 'EUR', { numberFormat: '1.000,00' }).text).toBe('€1,98M');
  });

  it('gives the exact form for tap-to-reveal', () => {
    expect(formatExact('1250340000', 'USD', { sign: 'always' })).toBe('+$1,250,340,000.00');
  });
});

describe('formatting a number while it is typed', () => {
  it('groups the whole part and keeps typed decimals', () => {
    expect(formatTyped('1563.50', 'USD')).toBe('1,563.50');
    expect(formatTyped('1563.', 'USD')).toBe('1,563.');
    expect(formatTyped('104231.7', 'PKR')).toBe('1,04,231.7');
    expect(formatTyped('1663.50−100', 'USD')).toBe('1,663.50 − 100');
    expect(formatTyped('−5', 'USD')).toBe('−5');
    expect(formatTyped('1234.5', 'EUR', '1.000,00')).toBe('1.234,5');
  });
});
