import { Decimal, toDecimalString, type DecimalString, type DecimalValue } from './money';

/**
 * The amount keypad's calculator: digits, ".", and ÷ × − +, evaluated exactly
 * (decimal, not floating point) with the usual precedence. The line above the
 * amount shows the expression; = (or saving) works it out.
 */
export type CalcKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '+' | '−' | '×' | '÷' | '=' | 'back' | 'clear';

const OPERATORS = ['+', '−', '×', '÷'] as const;
type Operator = (typeof OPERATORS)[number];
const isOperator = (c: string): c is Operator => (OPERATORS as readonly string[]).includes(c);

/** Places kept when a division doesn't come out even; the amount is then rounded half-to-even to these. */
export const DIVISION_PLACES = 20;

/** Applies one key to the expression text. "=" replaces it with the result (or leaves it if it can't be worked out). */
export function pressKey(expression: string, key: CalcKey, maxDecimals?: number): string {
  if (key === 'clear') return '';
  if (key === 'back') return expression.slice(0, -1);
  if (key === '=') {
    const value = evaluate(expression, maxDecimals);
    return value === null ? expression : value;
  }
  const last = expression.slice(-1);
  if (isOperator(key)) {
    if (expression === '' || expression === '−') return key === '−' ? '−' : expression;
    if (isOperator(last)) return expression.slice(0, -1) + key;
    if (last === '.') return expression.slice(0, -1) + key;
    return expression + key;
  }
  const number = currentNumber(expression);
  if (key === '.') {
    if (number.includes('.')) return expression;
    return expression + (number === '' ? '0.' : '.');
  }
  // A digit.
  if (maxDecimals !== undefined && number.includes('.') && number.split('.')[1].length >= maxDecimals) return expression;
  if (number === '0') return expression.slice(0, -1) + key;
  return expression + key;
}

/** The number being typed at the end of the expression. */
function currentNumber(expression: string): string {
  const m = /[0-9.]*$/.exec(expression);
  return m ? m[0] : '';
}

/** True when the expression has an operator in it (so the line above the amount should show it). */
export function hasOperator(expression: string): boolean {
  return /[+×÷]|.−/.test(expression);
}

/**
 * Works the expression out exactly. Returns a decimal string, or null when it's
 * empty, incomplete, or divides by zero. A result with more decimals than
 * `maxDecimals` (from a division) is rounded half-to-even.
 */
export function evaluate(expression: string, maxDecimals?: number): DecimalString | null {
  let text = expression;
  while (text && (isOperator(text.slice(-1)) || text.endsWith('.'))) text = text.slice(0, -1);
  if (!text || text === '−') return null;

  const tokens: (DecimalValue | Operator)[] = [];
  let i = 0;
  let negative = false;
  if (text[0] === '−') {
    negative = true;
    i = 1;
  }
  while (i < text.length) {
    const m = /^[0-9]+(\.[0-9]*)?|^\.[0-9]+/.exec(text.slice(i));
    if (!m) return null;
    const value = new Decimal(m[0].endsWith('.') ? m[0].slice(0, -1) : m[0]);
    tokens.push(negative ? value.negated() : value);
    negative = false;
    i += m[0].length;
    if (i < text.length) {
      const op = text[i];
      if (!isOperator(op)) return null;
      tokens.push(op);
      i += 1;
    }
  }

  // × and ÷ first, then + and −, left to right.
  const sums: (DecimalValue | Operator)[] = [tokens[0]];
  for (let k = 1; k < tokens.length; k += 2) {
    const op = tokens[k] as Operator;
    const right = tokens[k + 1] as DecimalValue;
    if (op === '×' || op === '÷') {
      const left = sums.pop() as DecimalValue;
      if (op === '÷' && right.isZero()) return null;
      sums.push(op === '×' ? left.times(right) : left.dividedBy(right).toDecimalPlaces(DIVISION_PLACES, Decimal.ROUND_HALF_EVEN));
    } else {
      sums.push(op, right);
    }
  }
  let result = sums[0] as DecimalValue;
  for (let k = 1; k < sums.length; k += 2) {
    const right = sums[k + 1] as DecimalValue;
    result = sums[k] === '+' ? result.plus(right) : result.minus(right);
  }
  if (maxDecimals !== undefined && result.decimalPlaces() > maxDecimals) {
    result = result.toDecimalPlaces(maxDecimals, Decimal.ROUND_HALF_EVEN);
  }
  return toDecimalString(result).replace(/^-/, '−');
}

/** The expression's value as a plain decimal string for storage ("−" → "-"), or null. */
export function expressionValue(expression: string, maxDecimals?: number): DecimalString | null {
  const v = evaluate(expression, maxDecimals);
  return v === null ? null : v.replace('−', '-');
}
