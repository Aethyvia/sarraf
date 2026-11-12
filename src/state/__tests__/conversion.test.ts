import { rateFromYFirst, workOut } from '../conversion';

describe('three linked numbers (option D)', () => {
  it('money back: ₨2,780 back at 1 USD = 278 PKR counts as $10.00', () => {
    expect(workOut({ x: '2780', known: 'rate', rate: '278', y: null, curY: 'USD', rateFromY: true })).toEqual({ rate: '278', y: '10' });
  });

  it('rounds the worked-out amount once, half-to-even, to its currency', () => {
    // 1000 / 278 = 3.5971… → 3.60
    expect(workOut({ x: '1000', known: 'rate', rate: '278', y: null, curY: 'USD', rateFromY: true }).y).toBe('3.6');
    // $250 at 1 USD = 278.125 PKR = 69,531.25
    expect(workOut({ x: '250', known: 'rate', rate: '278.125', y: null, curY: 'PKR', rateFromY: false }).y).toBe('69531.25');
  });

  it('typing the other amount works out the rate, written stronger first', () => {
    expect(workOut({ x: '250', known: 'y', rate: null, y: '69500', curY: 'PKR', rateFromY: false }).rate).toBe('278');
    expect(workOut({ x: '8450', known: 'y', rate: null, y: '27.46', curY: 'EUR', rateFromY: true }).rate).toBe('307.7203204661');
  });

  it('gives nothing to work out from a missing or zero number', () => {
    expect(workOut({ x: null, known: 'rate', rate: '278', y: null, curY: 'USD', rateFromY: true }).y).toBeNull();
    expect(workOut({ x: '10', known: 'rate', rate: '0', y: null, curY: 'USD', rateFromY: true }).y).toBeNull();
    expect(workOut({ x: '10', known: 'y', rate: null, y: '0', curY: 'USD', rateFromY: true }).rate).toBeNull();
  });

  it('writes the stronger currency first', () => {
    expect(rateFromYFirst('278')).toBe(true);
    expect(rateFromYFirst('0.0036')).toBe(false);
    expect(rateFromYFirst(null)).toBe(true);
  });
});
