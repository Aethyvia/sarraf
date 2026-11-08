import { eq } from 'drizzle-orm';

import { ensureBaseData } from '../base-data';
import { buildSampleData, SAMPLE_TODAY } from '../sample';
import { accounts, categories, people, personEntries } from '../schema';
import { accountBalances } from '@/data/balances';
import { currencyTiles, estimatedTotal } from '@/data/home';
import { needsReview } from '@/data/review';
import { listTransactions, recentTransactions } from '@/data/transaction-list';
import { createTestDb } from '@/test/db';
import { add } from '@/lib/money';

async function sample() {
  const db = await createTestDb();
  ensureBaseData(db);
  db.transaction((tx) => buildSampleData(tx));
  return db;
}

describe('the sample data matches the design canvas (Spec §19)', () => {
  it('has the Sep 30 balances', async () => {
    const db = await sample();
    const balances = accountBalances(db, SAMPLE_TODAY);
    const byName = Object.fromEntries(db.select().from(accounts).all().map((a) => [a.name, balances.get(a.id)]));
    expect(byName).toEqual({
      'Payoneer USD': '1250',
      'Payoneer EUR': '340',
      'Alfalah PKR': '104231.75',
      'Cash PKR': '2500',
      'Cash AED': '1200',
      'Cash SAR': '450',
    });
  });

  it('shows Home’s tiles: balance, In / Out this month, Usable, in tile order', async () => {
    const db = await sample();
    const tiles = currencyTiles(db, SAMPLE_TODAY);
    expect(tiles.map((t) => [t.currency, t.balance, t.in, t.out, t.usable])).toEqual([
      ['USD', '1250', '1650', '1013', '850'],
      ['PKR', '106731.75', '0', '4721.17', '106731.75'],
      ['EUR', '340', '340', '0', '340'],
      ['AED', '1200', '0', '310', '1200'],
      ['SAR', '450', '0', '0', '450'],
    ]);
  });

  it('estimates the total at ≈ $2,447.69', async () => {
    const db = await sample();
    const est = estimatedTotal(db, 'USD', SAMPLE_TODAY);
    expect(est.total).toBe('2447.69');
    expect(Object.fromEntries(est.perCurrency)).toEqual({ PKR: '383.79', EUR: '367.2', AED: '326.7', SAR: '120' });
    expect(est.ratesFrom).toBe('2026-09-30T06:00:00.000Z');
  });

  it('has John owing $250 and €40, and you owing John ₨8,450', async () => {
    const db = await sample();
    const john = db.select().from(people).where(eq(people.name, 'John')).get()!;
    const entries = db.select().from(personEntries).where(eq(personEntries.personId, john.id)).all();
    const by = (c: string) => add(...entries.filter((e) => e.currency === c).map((e) => e.amount));
    expect([by('USD'), by('EUR'), by('PKR')]).toEqual(['250', '40', '-8450']);
  });

  it('has 3 things to confirm, 2 upcoming and 1 waiting for money back', async () => {
    const db = await sample();
    const r = needsReview(db, SAMPLE_TODAY);
    expect([r.toConfirm, r.upcomingCount, r.waitingBack.length]).toEqual([3, 2, 1]);
  });

  it('lists transactions newest first, with the reimbursement under its original and repeated on its own day', async () => {
    const db = await sample();
    const groups = listTransactions(db, {}, SAMPLE_TODAY);
    expect(groups[0].date).toBe('2026-09-29');
    const echo = groups[0].rows.find((r) => r.echoOf);
    expect(echo).toMatchObject({ title: 'Reimbursed by client', amount: { value: '120', tone: 'income' }, echoOf: { date: '2026-09-26' } });
    const travel = groups.find((g) => g.date === '2026-09-26')!.rows.find((r) => r.title === 'Client travel expense' && r.children.length)!;
    expect(travel.tags).toContain('reimbursed');
    expect(travel.children.map((c) => c.title)).toEqual(['Reimbursed by client']);
    const transfer = groups.find((g) => g.date === '2026-09-26')!.rows.find((r) => r.sent);
    expect(transfer).toMatchObject({ amount: { value: '13725', currency: 'PKR', tone: 'neutral' }, sent: { value: '49.46', currency: 'USD' }, tags: ['in_transit'] });
    // Upcoming (Oct 26) isn't listed.
    expect(groups.some((g) => g.date > SAMPLE_TODAY)).toBe(false);
  });

  it('filters by kind, currency, category (with subcategories) and reimbursable', async () => {
    const db = await sample();
    const count = (f: Parameters<typeof listTransactions>[1]) => listTransactions(db, f, SAMPLE_TODAY).flatMap((g) => g.rows).filter((r) => !r.echoOf).length;
    expect(count({ kinds: ['income'], currencies: ['EUR'] })).toBe(1);
    expect(count({ reimbursable: true })).toBe(2);
    expect(count({ currencies: ['AED'] })).toBe(2); // opening balance + the Dubai expense
    const consulting = db.select().from(categories).where(eq(categories.name, 'Consulting income')).get()!;
    // Consulting income itself (3) plus its Retainer and One-off projects subcategories (1 each).
    expect(count({ categoryIds: [consulting.id] })).toBe(5);
  });

  it('gives Home’s Recent: the last 6, without opening balances or repeats', async () => {
    const db = await sample();
    const recent = recentTransactions(db, 6, SAMPLE_TODAY);
    expect(recent).toHaveLength(6);
    expect(recent[0]).toMatchObject({ date: '2026-09-29', title: 'Netflix', tags: ['auto_review'] });
    expect(recent.every((r) => !r.echoOf && r.kind !== 'opening_balance')).toBe(true);
  });
});
