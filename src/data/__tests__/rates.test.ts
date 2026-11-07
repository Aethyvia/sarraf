import { marketRate, ratesAreStale, ratesFetchedAt, storeRates } from '../rates';
import { createTestDb } from '@/test/db';

describe('market rates', () => {
  it('works out any pair from quotes against USD', async () => {
    const db = await createTestDb();
    storeRates(db, { PKR: '278.10', EUR: '0.925', AED: 3.6725, BAD: 'x', XYZ1: 1 }, '2026-09-30T06:00:00Z');
    expect(marketRate(db, 'USD', 'PKR')).toEqual({ rate: '278.1', fetchedAt: '2026-09-30T06:00:00Z' });
    expect(marketRate(db, 'PKR', 'USD')!.rate).toBe('0.0035958288');
    expect(marketRate(db, 'EUR', 'PKR')!.rate).toBe('300.6486486486');
    expect(marketRate(db, 'USD', 'USD')).toBeNull();
    expect(marketRate(db, 'USD', 'SAR')).toBeNull();
    expect(ratesFetchedAt(db)).toBe('2026-09-30T06:00:00Z');
  });

  it('replaces the old set and goes stale after 6 hours', async () => {
    const db = await createTestDb();
    expect(ratesAreStale(ratesFetchedAt(db))).toBe(true);
    storeRates(db, { PKR: '270' }, '2026-09-29T00:00:00Z');
    storeRates(db, { PKR: '278.10' }, '2026-09-30T06:00:00Z');
    expect(marketRate(db, 'USD', 'PKR')!.rate).toBe('278.1');
    expect(ratesAreStale('2026-09-30T06:00:00Z', new Date('2026-09-30T11:59:00Z'))).toBe(false);
    expect(ratesAreStale('2026-09-30T06:00:00Z', new Date('2026-09-30T12:01:00Z'))).toBe(true);
  });
});
