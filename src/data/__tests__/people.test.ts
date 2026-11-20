import { eq } from 'drizzle-orm';

import { people, personEntries, splitShares, transactions } from '@/db/schema';
import { deletePerson, personDeletionImpact, updatePerson } from '../people';
import { setup } from '@/test/factories';

async function scenario() {
  const s = await setup();
  const usd = s.account('Payoneer USD', 'USD');
  const pkr = s.account('Alfalah PKR', 'PKR');
  const john = s.person('John');
  const sana = s.person('Sana');
  const entry = (personId: string, transactionId: string | null, source: 'transfer' | 'split' | 'paid_by_person' | 'settlement', amount: string, currency = 'USD') =>
    s.db.insert(personEntries).values({ id: crypto.randomUUID(), personId, transactionId, source, currency, amount, date: '2026-09-20' }).run();

  // Lent John $250.
  const lend = s.tx({ kind: 'transfer', accountId: usd, transferPersonId: john, amount: '250', date: '2026-09-05' });
  entry(john, lend, 'transfer', '250');
  // John paid for dinner; your share ₨521.17.
  const dinner = s.tx({ paidByPersonId: john, amount: '521.17', currency: 'PKR', date: '2026-09-28' });
  entry(john, dinner, 'paid_by_person', '-521.17', 'PKR');
  // You paid a $90 lunch split three ways with John and Sana.
  const lunch = s.tx({ accountId: usd, amount: '90', date: '2026-09-12' });
  s.db.insert(splitShares)
    .values([
      { id: 'me', transactionId: lunch, personId: null, shareAmount: '30', sharePercent: '33.33', splitMode: 'equal' },
      { id: 'john', transactionId: lunch, personId: john, shareAmount: '30', splitMode: 'equal' },
      { id: 'sana', transactionId: lunch, personId: sana, shareAmount: '30', splitMode: 'equal' },
    ])
    .run();
  entry(john, lunch, 'split', '30');
  entry(sana, lunch, 'split', '30');
  // A settlement with John.
  entry(john, null, 'settlement', '-40');
  // Income where John is only tagged, and an expense he's expected to pay back.
  const tagged = s.tx({ kind: 'income', accountId: pkr, referencePersonId: john, currency: 'PKR', amount: '1000' });
  const reimbursable = s.tx({ accountId: usd, reimbursable: true, expectedFromPersonId: john, reimbursementStatus: 'awaiting' });

  return { ...s, usd, pkr, john, sana, lend, dinner, lunch, tagged, reimbursable };
}

describe('deleting a person', () => {
  it('reports what changes', async () => {
    const { db, john } = await scenario();
    expect(personDeletionImpact(db, john)).toMatchObject({ count: 2, splits: 1, tagged: 2 });
  });

  it('deletes transfers and expenses they paid, gives you their split share, removes settlements and clears tags', async () => {
    const { db, john, sana, lend, dinner, lunch, tagged, reimbursable } = await scenario();
    deletePerson(db, john);

    const ids = db.select({ id: transactions.id }).from(transactions).all().map((r) => r.id);
    expect(ids).not.toContain(lend);
    expect(ids).not.toContain(dinner);
    expect(ids).toEqual(expect.arrayContaining([lunch, tagged, reimbursable]));

    const shares = db.select().from(splitShares).where(eq(splitShares.transactionId, lunch)).all();
    expect(shares.map((s) => [s.personId, s.shareAmount, s.splitMode, s.sharePercent]).sort()).toEqual(
      [
        [null, '60', 'amounts', null],
        [sana, '30', 'amounts', null],
      ].sort(),
    );

    expect(db.select().from(personEntries).all().map((e) => e.personId)).toEqual([sana]);
    expect(db.select().from(transactions).where(eq(transactions.id, tagged)).get()!.referencePersonId).toBeNull();
    const r = db.select().from(transactions).where(eq(transactions.id, reimbursable)).get()!;
    expect(r).toMatchObject({ expectedFromPersonId: null, reimbursable: true, reimbursementStatus: 'awaiting' });
    expect(db.select().from(people).all().map((p) => p.name)).toEqual(['Sana']);
  });

  it('just removes their row from a split someone else paid', async () => {
    const { db, sana, john, tx } = await scenario();
    const trip = tx({ paidByPersonId: sana, amount: '20', date: '2026-09-25' });
    db.insert(splitShares)
      .values([
        { id: 't-me', transactionId: trip, personId: null, shareAmount: '20', splitMode: 'equal' },
        { id: 't-john', transactionId: trip, personId: john, shareAmount: '20', splitMode: 'equal' },
      ])
      .run();
    deletePerson(db, john);
    const shares = db.select().from(splitShares).where(eq(splitShares.transactionId, trip)).all();
    expect(shares.map((s) => [s.personId, s.shareAmount])).toEqual([[null, '20']]);
  });

  it('keeps the name required and the note optional', async () => {
    const { db, john } = await scenario();
    updatePerson(db, john, { note: '  ' });
    expect(db.select().from(people).where(eq(people.id, john)).get()!.note).toBeNull();
    expect(() => updatePerson(db, john, { name: '' })).toThrow();
  });
});

describe('profile pictures (owner, Nov 20)', () => {
  it('set, replace and remove; the old file is handed back to delete', async () => {
    const { setPersonPhoto } = jest.requireActual('../people') as typeof import('../people');
    const s = await setup();
    const john = s.person('John');
    const photo = () => s.db.select().from(people).where(eq(people.id, john)).get()!.photoPath;
    expect(setPersonPhoto(s.db, john, 'attachments/a1.jpg')).toEqual({ removedPath: null });
    expect(photo()).toBe('attachments/a1.jpg');
    expect(setPersonPhoto(s.db, john, 'attachments/b2.jpg')).toEqual({ removedPath: 'attachments/a1.jpg' });
    expect(setPersonPhoto(s.db, john, null)).toEqual({ removedPath: 'attachments/b2.jpg' });
    expect(photo()).toBeNull();
  });

  it('goes with the person when they’re deleted', async () => {
    const { setPersonPhoto } = jest.requireActual('../people') as typeof import('../people');
    const s = await setup();
    const sana = s.person('Sana');
    setPersonPhoto(s.db, sana, 'attachments/sana.jpg');
    expect(deletePerson(s.db, sana).attachmentPaths).toContain('attachments/sana.jpg');
  });

  it('is one of the stored files (backup, export, the clean-up sweep)', async () => {
    const { setPersonPhoto } = jest.requireActual('../people') as typeof import('../people');
    const { storedFileRefs } = jest.requireActual('../attachments') as typeof import('../attachments');
    const s = await setup();
    const john = s.person('John');
    s.person('Sana');
    setPersonPhoto(s.db, john, 'attachments/0f1e2d3c-4b5a-4968-8776-655443322110.jpg');
    expect(storedFileRefs(s.db)).toEqual([{ id: '0f1e2d3c-4b5a-4968-8776-655443322110', path: 'attachments/0f1e2d3c-4b5a-4968-8776-655443322110.jpg' }]);
  });
});
