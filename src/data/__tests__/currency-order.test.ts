import { currencyOrder } from '@/db/schema';
import { moveCurrency } from '../currency-order';
import { createTestDb } from '@/test/db';

describe('Reorder currencies', () => {
  it('moves one currency to a position and keeps the rest in order', async () => {
    const db = await createTestDb();
    const order = ['USD', 'PKR', 'EUR', 'AED'];
    expect(moveCurrency(db, order, 'EUR', 0)).toEqual(['EUR', 'USD', 'PKR', 'AED']);
    expect(db.select().from(currencyOrder).orderBy(currencyOrder.rank).all().map((r) => r.currency)).toEqual(['EUR', 'USD', 'PKR', 'AED']);
    expect(moveCurrency(db, ['EUR', 'USD', 'PKR', 'AED'], 'EUR', 3)).toEqual(['USD', 'PKR', 'AED', 'EUR']);
  });
});
