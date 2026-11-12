import { eq } from 'drizzle-orm';

import { recurringItems, transactions } from '@/db/schema';
import { accountBalance } from '../balances';
import { confirmTransaction } from '../review';
import {
  backfillRecurring,
  createRecurring,
  firstDueOnOrAfter,
  nextDue,
  payRecurring,
  recurringOnHome,
  remindersDue,
  skipRecurring,
  type RecurringInput,
} from '../recurring';
import { saveTransaction } from '../transactions';
import { setup } from '@/test/factories';

async function world() {
  const s = await setup();
  const usd = s.account('Payoneer USD', 'USD');
  const pkr = s.account('Alfalah PKR', 'PKR');
  s.tx({ kind: 'opening_balance', accountId: usd, amount: '1000', accountAmount: '1000', date: '2026-08-01' });
  const base: RecurringInput = {
    kind: 'expense',
    amountType: 'same',
    name: 'Netflix',
    amount: '15.49',
    accountId: usd,
    rule: { freq: 'monthly', interval: 1, day: 8 },
    showOnHomeDays: 3,
    autoAdd: true,
  };
  const item = (id: string) => s.db.select().from(recurringItems).where(eq(recurringItems.id, id)).get()!;
  const made = (id: string) => s.db.select().from(transactions).where(eq(transactions.recurringId, id)).all();
  return { ...s, usd, pkr, base, item, made };
}

describe('repeat rules', () => {
  it('monthly keeps its day, falling on the last day of short months', () => {
    const rule = { freq: 'monthly' as const, interval: 1, day: 31 };
    expect(firstDueOnOrAfter(rule, '2026-02-10')).toBe('2026-02-28');
    expect(nextDue(rule, '2026-02-28')).toBe('2026-03-31');
    expect(nextDue(rule, '2026-12-31')).toBe('2027-01-31');
    expect(nextDue({ freq: 'monthly', interval: 3, day: 12 }, '2026-11-12')).toBe('2027-02-12');
  });

  it('weekly lands on its weekday; yearly on its date', () => {
    // 2026-09-30 is a Wednesday (3).
    expect(firstDueOnOrAfter({ freq: 'weekly', interval: 1, day: 1 }, '2026-09-30')).toBe('2026-10-05');
    expect(firstDueOnOrAfter({ freq: 'weekly', interval: 1, day: 3 }, '2026-09-30')).toBe('2026-09-30');
    expect(nextDue({ freq: 'weekly', interval: 2, day: 3 }, '2026-09-30')).toBe('2026-10-14');
    expect(firstDueOnOrAfter({ freq: 'yearly', interval: 1, day: 29, month: 2 }, '2026-03-01')).toBe('2027-02-28');
  });
});

describe('missed auto-adds (Decided Nov 7)', () => {
  it('adds one per missed due date, with its real date, never twice', async () => {
    const w = await world();
    const id = createRecurring(w.db, w.base, '2026-08-01');
    expect(w.item(id).nextDueDate).toBe('2026-08-08');

    const added = backfillRecurring(w.db, '2026-09-30');
    expect(added.map((t) => [t.date, t.status, t.autoAdded])).toEqual([
      ['2026-08-08', 'pending', true],
      ['2026-09-08', 'pending', true],
    ]);
    expect(w.item(id).nextDueDate).toBe('2026-10-08');
    // Opening the app again adds nothing.
    expect(backfillRecurring(w.db, '2026-09-30')).toEqual([]);
    expect(w.made(id)).toHaveLength(2);
    // Pending counts nowhere until confirmed.
    expect(accountBalance(w.db, w.usd, '2026-09-30')).toBe('1000');
    confirmTransaction(w.db, added[0].id, '2026-08-08', '2026-09-30');
    expect(accountBalance(w.db, w.usd, '2026-09-30')).toBe('984.51');
  });

  it('stops at its end: a date or a number of times', async () => {
    const w = await world();
    const byDate = createRecurring(w.db, { ...w.base, endsOn: '2026-09-01' }, '2026-08-01');
    const byCount = createRecurring(w.db, { ...w.base, name: 'Gym', maxOccurrences: 1 }, '2026-08-01');
    backfillRecurring(w.db, '2026-12-31');
    expect(w.made(byDate)).toHaveLength(1);
    expect(w.made(byCount)).toHaveLength(1);
    expect([w.item(byDate).active, w.item(byCount).active]).toEqual([false, false]);
  });

  it('a transfer lands In transit; between currencies it waits for what arrived', async () => {
    const w = await world();
    const id = createRecurring(w.db, { ...w.base, kind: 'transfer', name: 'Withdrawal', amount: '500', toAccountId: w.pkr, rule: { freq: 'monthly', interval: 1, day: 1 } }, '2026-09-01');
    const [t] = backfillRecurring(w.db, '2026-09-30');
    expect(t).toMatchObject({ status: 'in_transit', toAmount: null, accountAmount: '500', recurringId: id });
    // It has left Payoneer USD already (In transit), but hasn't reached Alfalah.
    expect(accountBalance(w.db, w.usd, '2026-09-30')).toBe('500');
  });

  it('never auto-adds a bill or a "Remind me" item; reminders wait in Needs review', async () => {
    const w = await world();
    const bill = createRecurring(w.db, { ...w.base, name: 'Electricity', amountType: 'varies', amount: null, autoAdd: true }, '2026-09-01');
    const remind = createRecurring(w.db, { ...w.base, name: 'Rent', autoAdd: false }, '2026-09-01');
    expect(backfillRecurring(w.db, '2026-09-30')).toEqual([]);
    expect(w.item(bill).autoAdd).toBe(false);
    expect(remindersDue(w.db, '2026-09-30').map((i) => i.id)).toEqual([remind]);
  });
});

describe('Home and paying', () => {
  it('shows from its Show on Home day and stays until handled', async () => {
    const w = await world();
    const id = createRecurring(w.db, { ...w.base, autoAdd: false, rule: { freq: 'monthly', interval: 1, day: 12 } }, '2026-10-01');
    expect(recurringOnHome(w.db, '2026-10-08')).toEqual([]);
    expect(recurringOnHome(w.db, '2026-10-09').map((r) => r.item.id)).toEqual([id]);
    expect(recurringOnHome(w.db, '2026-10-20')[0]).toMatchObject({ due: '2026-10-12', overdue: true });

    // Paid from Home: Cleared today, the item moves to next month and remembers the amount.
    const paid = payRecurring(w.db, id, '2026-10-20');
    expect(w.db.select().from(transactions).where(eq(transactions.id, paid)).get()).toMatchObject({ status: 'cleared', date: '2026-10-20', recurringDueDate: '2026-10-12', autoAdded: false });
    expect(w.item(id)).toMatchObject({ nextDueDate: '2026-11-12', lastAmount: '15.49', occurrences: 1 });
    expect(recurringOnHome(w.db, '2026-10-20')).toEqual([]);
  });

  it('a bill added with its real amount remembers it ("Usually …"); skipping moves on with nothing added', async () => {
    const w = await world();
    const id = createRecurring(w.db, { ...w.base, name: 'Electricity', amountType: 'varies', amount: null, accountId: w.pkr, rule: { freq: 'monthly', interval: 1, day: 5 } }, '2026-10-01');
    const item = w.item(id);
    saveTransaction(w.db, { kind: 'expense', date: '2026-10-06', status: 'cleared', accountId: w.pkr, amount: '5500', currency: 'PKR', recurringId: id, recurringDueDate: item.nextDueDate }, { today: '2026-10-06' });
    expect(w.item(id)).toMatchObject({ lastAmount: '5500', nextDueDate: '2026-11-05' });
    skipRecurring(w.db, id);
    expect(w.item(id).nextDueDate).toBe('2026-12-05');
    expect(w.made(id)).toHaveLength(1);
  });
});

describe('recurring in another currency than its account (Owner, Nov 12)', () => {
  it('keeps its own currency, never auto-adds, and waits for you to confirm what was charged', async () => {
    const w = await world();
    const id = createRecurring(w.db, { ...w.base, name: 'Adobe', amount: '54.99', currency: 'USD', accountId: w.pkr, autoAdd: true }, '2026-09-01');
    expect(w.item(id)).toMatchObject({ currency: 'USD', accountId: w.pkr, autoAdd: false });
    expect(backfillRecurring(w.db, '2026-12-01')).toHaveLength(0);
    expect(() => payRecurring(w.db, id, '2026-09-08')).toThrow();
    expect(remindersDue(w.db, '2026-09-08').map((i) => i.id)).toContain(id);
  });

  it('defaults to the account currency, and a transfer always uses the From account’s', async () => {
    const w = await world();
    const a = createRecurring(w.db, { ...w.base, currency: null }, '2026-09-01');
    expect(w.item(a)).toMatchObject({ currency: 'USD', autoAdd: true });
    const t = createRecurring(w.db, { ...w.base, kind: 'transfer', toAccountId: w.pkr, currency: 'EUR' }, '2026-09-01');
    expect(w.item(t).currency).toBe('USD');
  });
});
