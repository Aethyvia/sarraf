import { eq } from 'drizzle-orm';

import { budgets, ledgers, recurringItems, transactions } from '@/db/schema';
import {
  archiveLedger,
  createLedger,
  deleteLedger,
  ledgerDeletionImpact,
  setDefaultLedger,
  unarchiveLedger,
} from '../ledgers';
import { LimitReachedError } from '../limits';
import { setup } from '@/test/factories';

const defaults = (db: Awaited<ReturnType<typeof setup>>['db']) =>
  db.select().from(ledgers).where(eq(ledgers.isDefault, true)).all().map((l) => l.name);

describe('ledgers', () => {
  it('makes the first ledger the default, and later ones not', async () => {
    const { db } = await setup();
    createLedger(db, { name: 'Business' }, 'free');
    expect(defaults(db)).toEqual(['Personal']);
  });

  it('keeps exactly one default when it changes', async () => {
    const { db } = await setup();
    const business = createLedger(db, { name: 'Business' }, 'free');
    setDefaultLedger(db, business);
    expect(defaults(db)).toEqual(['Business']);
  });

  it('allows 2 ledgers on Free; archived ones free a slot; unarchiving counts as adding', async () => {
    const { db } = await setup();
    const business = createLedger(db, { name: 'Business' }, 'free');
    expect(() => createLedger(db, { name: 'Side gig' }, 'free')).toThrow(LimitReachedError);
    archiveLedger(db, business);
    createLedger(db, { name: 'Side gig' }, 'free');
    expect(() => unarchiveLedger(db, business, 'free')).toThrow(LimitReachedError);
    createLedger(db, { name: 'Fourth' }, 'plus');
  });

  it("won't archive or delete the default ledger, or make an archived one default", async () => {
    const { db, personal } = await setup();
    const business = createLedger(db, { name: 'Business' }, 'free');
    expect(() => archiveLedger(db, personal)).toThrow(/default/);
    expect(() => deleteLedger(db, personal, { mode: 'delete_with_transactions' })).toThrow(/default/);
    archiveLedger(db, business);
    expect(() => setDefaultLedger(db, business)).toThrow(/archived/);
  });
});

describe('deleting a ledger in use', () => {
  async function withBusinessData() {
    const s = await setup();
    const business = createLedger(s.db, { name: 'Business' }, 'free');
    const usd = s.account('Payoneer USD', 'USD');
    s.tx({ ledgerId: business, accountId: usd, date: '2026-09-05' });
    s.tx({ ledgerId: business, accountId: usd, date: '2026-09-20' });
    s.tx({ ledgerId: s.personal, accountId: usd, date: '2026-09-21' });
    s.db.insert(budgets).values({ id: 'b1', ledgerId: business, currency: 'USD', amount: '500', period: 'monthly' }).run();
    s.db
      .insert(recurringItems)
      .values({
        id: 'r1',
        kind: 'expense',
        amountType: 'same',
        name: 'Adobe',
        amount: '54.99',
        currency: 'USD',
        accountId: usd,
        ledgerId: business,
        repeatRule: { freq: 'monthly', interval: 1, day: 12 },
        nextDueDate: '2026-10-12',
      })
      .run();
    return { ...s, business, usd };
  }

  it('reports transactions, budgets and recurring items', async () => {
    const { db, business } = await withBusinessData();
    expect(ledgerDeletionImpact(db, business)).toMatchObject({
      count: 2,
      firstDate: '2026-09-05',
      lastDate: '2026-09-20',
      budgets: 1,
      recurringItems: 1,
    });
  });

  it('moves transactions and recurring items to another ledger and deletes its budgets', async () => {
    const { db, business, personal } = await withBusinessData();
    deleteLedger(db, business, { mode: 'move', targetLedgerId: personal });
    expect(db.select().from(transactions).where(eq(transactions.ledgerId, personal)).all()).toHaveLength(3);
    expect(db.select().from(recurringItems).get()!.ledgerId).toBe(personal);
    expect(db.select().from(budgets).all()).toHaveLength(0);
    expect(db.select().from(ledgers).all().map((l) => l.name)).toEqual(['Personal']);
  });

  it('can delete it with its transactions', async () => {
    const { db, business } = await withBusinessData();
    deleteLedger(db, business, { mode: 'delete_with_transactions' });
    expect(db.select().from(transactions).all()).toHaveLength(1);
    expect(db.select().from(recurringItems).all()).toHaveLength(0);
    expect(db.select().from(budgets).all()).toHaveLength(0);
  });

  it('refuses to move into itself or an archived ledger, and changes nothing', async () => {
    const { db, business } = await withBusinessData();
    const archived = createLedger(db, { name: 'Old' }, 'plus');
    archiveLedger(db, archived);
    expect(() => deleteLedger(db, business, { mode: 'move', targetLedgerId: business })).toThrow();
    expect(() => deleteLedger(db, business, { mode: 'move', targetLedgerId: archived })).toThrow(/archived/);
    expect(db.select().from(transactions).where(eq(transactions.ledgerId, business)).all()).toHaveLength(2);
    expect(db.select().from(budgets).all()).toHaveLength(1);
  });
});
