import { plantFor, stageRank } from '../plant';

describe('Savings F: the plant (owner, Nov 20)', () => {
  it('grows through the stages at 25, 50, 75 and 100%', () => {
    const at = (held: string) => plantFor(held, '2000', 'USD').stage;
    expect(at('0')).toBe('seed');
    expect(at('0.01')).toBe('sprout');
    expect(at('400')).toBe('sprout');
    expect(at('499.99')).toBe('sprout');
    expect(at('500')).toBe('plant');
    expect(at('1000')).toBe('bush');
    expect(at('1500')).toBe('tree');
    expect(at('1999.99')).toBe('tree');
    expect(at('2000')).toBe('fruit');
    expect(at('2500')).toBe('fruit');
  });

  it('says what the next stage needs, in the goal’s currency', () => {
    expect(plantFor('400', '2000', 'USD')).toEqual({ stage: 'sprout', pct: 20, next: { stage: 'plant', pct: 25, toGo: '100' } });
    expect(plantFor('0', '1250', 'USD').next).toEqual({ stage: 'plant', pct: 25, toGo: '312.5' });
    expect(plantFor('1999.99', '2000', 'USD')).toMatchObject({ pct: 99, next: { stage: 'fruit', toGo: '0.01' } });
    expect(plantFor('2000', '2000', 'USD')).toEqual({ stage: 'fruit', pct: 100, next: null });
  });

  it('rounds the amount needed up, so adding exactly that reaches the stage', () => {
    // 25% of ¥1,001 is ¥250.25 — JPY has no decimals, so ¥251 is needed.
    const v = plantFor('0', '1001', 'JPY');
    expect(v.next?.toGo).toBe('251');
    expect(plantFor('251', '1001', 'JPY').stage).toBe('plant');
    // 25% of KWD 0.003 → 0.00075 → 0.001 (three decimals).
    expect(plantFor('0', '0.003', 'KWD').next?.toGo).toBe('0.001');
  });

  it('a completed goal is a harvest; ranks only go up as it grows', () => {
    expect(plantFor('0', '2000', 'USD', true).stage).toBe('harvest');
    expect(stageRank('sprout')).toBeLessThan(stageRank('plant'));
    expect(stageRank('fruit')).toBeLessThan(stageRank('harvest'));
  });
});

describe('the harvest', () => {
  it('is what Mark as complete released back to Usable', async () => {
    const { setup } = jest.requireActual('@/test/factories') as typeof import('@/test/factories');
    const { addToGoal, completeGoal, createGoal, harvestedAmount } = jest.requireActual('../goals') as typeof import('../goals');
    const s = await setup();
    const usd = s.account('Payoneer USD', 'USD');
    s.tx({ kind: 'opening_balance', accountId: usd, amount: '1250', accountAmount: '1250', date: '2026-09-01' });
    const goal = createGoal(s.db, { name: 'Emergency fund', currency: 'USD', target: '2000' }, 'plus');
    addToGoal(s.db, { goalId: goal, accountId: usd, amount: '400', date: '2026-09-02' });
    expect(harvestedAmount(s.db, goal)).toBe('0');
    completeGoal(s.db, goal, '2026-09-30');
    expect(harvestedAmount(s.db, goal)).toBe('400');
  });
});
