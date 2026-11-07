import { evaluate, expressionValue, hasOperator, pressKey, type CalcKey } from '../calc';

const type = (keys: string, maxDecimals?: number) =>
  [...keys.replace(/<|C|=/g, (k) => `\u0000${k}\u0000`).split('\u0000')]
    .filter(Boolean)
    .flatMap((part) => (part === '<' ? ['back'] : part === 'C' ? ['clear'] : part === '=' ? ['='] : [...part]))
    .reduce((expr, k) => pressKey(expr, k as CalcKey, maxDecimals), '');

describe('keypad input', () => {
  it('builds numbers and expressions', () => {
    expect(type('1663.50−100.00')).toBe('1663.50−100.00');
    expect(type('12+3×2=')).toBe('18');
  });

  it('keeps one decimal point per number and adds a leading zero', () => {
    expect(type('1.2.3')).toBe('1.23');
    expect(type('.5')).toBe('0.5');
    expect(type('5+.5')).toBe('5+0.5');
  });

  it('replaces a trailing operator, and only lets − start an expression', () => {
    expect(type('5+×')).toBe('5×');
    expect(type('×5')).toBe('5');
    expect(type('−5')).toBe('−5');
  });

  it('drops a leading zero and limits decimals to the currency', () => {
    expect(type('007')).toBe('7');
    expect(type('1.239', 2)).toBe('1.23');
    expect(type('5.1', 0)).toBe('5.');
  });

  it('backspace and clear', () => {
    expect(type('123<')).toBe('12');
    expect(type('12+3C')).toBe('');
  });
});

describe('evaluate', () => {
  it('is exact', () => {
    expect(evaluate('0.1+0.2')).toBe('0.3');
    expect(evaluate('1663.50−100.00')).toBe('1563.5');
    expect(evaluate('99999999999999999999×10')).toBe('999999999999999999990');
  });

  it('follows × ÷ before + −', () => {
    expect(evaluate('2+3×4')).toBe('14');
    expect(evaluate('10−4÷2')).toBe('8');
    expect(evaluate('−5+2')).toBe('−3');
  });

  it('rounds an uneven division half-to-even to the currency', () => {
    expect(evaluate('10÷3', 2)).toBe('3.33');
    expect(evaluate('0.125×1', 2)).toBe('0.12');
    expect(evaluate('100÷8')).toBe('12.5');
  });

  it('ignores a trailing operator or point, and refuses ÷0 and empty input', () => {
    expect(evaluate('5+')).toBe('5');
    expect(evaluate('5.')).toBe('5');
    expect(evaluate('5÷0')).toBeNull();
    expect(evaluate('')).toBeNull();
    expect(evaluate('−')).toBeNull();
  });

  it('gives a storable value', () => {
    expect(expressionValue('5−8')).toBe('-3');
    expect(hasOperator('5−8')).toBe(true);
    expect(hasOperator('−8')).toBe(false);
    expect(hasOperator('85')).toBe(false);
  });
});
