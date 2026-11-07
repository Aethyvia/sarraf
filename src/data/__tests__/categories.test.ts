import { eq } from 'drizzle-orm';

import { budgets, categories, transactions } from '@/db/schema';
import {
  archiveCategory,
  categoryDeletionImpact,
  deleteCategory,
  feesCategoryId,
  updateCategory,
} from '../categories';
import { setup } from '@/test/factories';

describe('categories: two levels', () => {
  it('allows a subcategory under a top-level category of the same kind', async () => {
    const { category, db } = await setup();
    const consulting = category('Consulting income', 'income');
    const retainer = category('Retainer', 'income', consulting);
    expect(db.select().from(categories).where(eq(categories.id, retainer)).get()!.parentId).toBe(consulting);
  });

  it('refuses a third level, a parent of the other kind, and nesting a category that has children', async () => {
    const { category, db } = await setup();
    const consulting = category('Consulting income', 'income');
    const retainer = category('Retainer', 'income', consulting);
    const travel = category('Travel', 'expense');
    expect(() => category('Deeper', 'income', retainer)).toThrow(/two levels/);
    expect(() => category('Mixed', 'expense', consulting)).toThrow(/kind/);
    expect(() => updateCategory(db, consulting, { parentId: travel })).toThrow(/subcategories/);
    expect(() => updateCategory(db, retainer, { parentId: retainer })).toThrow(/own parent/);
  });

  it('can move a subcategory to the top level', async () => {
    const { category, db } = await setup();
    const consulting = category('Consulting income', 'income');
    const retainer = category('Retainer', 'income', consulting);
    updateCategory(db, retainer, { parentId: null });
    expect(db.select().from(categories).where(eq(categories.id, retainer)).get()!.parentId).toBeNull();
  });
});

describe('category kind', () => {
  it('can switch while unused, taking its subcategories along', async () => {
    const { category, db } = await setup();
    const parent = category('Misc', 'expense');
    const child = category('Misc child', 'expense', parent);
    updateCategory(db, parent, { kind: 'income' });
    const kinds = db.select({ kind: categories.kind }).from(categories).where(eq(categories.parentId, parent)).all();
    expect(kinds).toEqual([{ kind: 'income' }]);
    expect(db.select().from(categories).where(eq(categories.id, child)).get()!.kind).toBe('income');
  });

  it('is locked once a transaction uses it or one of its subcategories', async () => {
    const { category, tx, db } = await setup();
    const parent = category('Groceries', 'expense');
    const child = category('Fruit', 'expense', parent);
    tx({ categoryId: child });
    expect(() => updateCategory(db, parent, { kind: 'income' })).toThrow(/locked/);
    expect(() => updateCategory(db, child, { kind: 'income' })).toThrow();
    updateCategory(db, parent, { name: 'Food' }); // other edits still work
    expect(db.select().from(categories).where(eq(categories.id, parent)).get()!.name).toBe('Food');
  });
});

describe('Fees & charges', () => {
  it('can be renamed but never deleted, archived, nested or switched to income', async () => {
    const { category, db } = await setup();
    const fees = feesCategoryId(db);
    const travel = category('Travel');
    updateCategory(db, fees, { name: 'Fees' });
    expect(db.select().from(categories).where(eq(categories.id, fees)).get()!.name).toBe('Fees');
    expect(() => deleteCategory(db, fees, { mode: 'delete_with_transactions' })).toThrow(/not deleted/);
    expect(() => archiveCategory(db, fees)).toThrow(/not removed/);
    expect(() => updateCategory(db, fees, { parentId: travel })).toThrow(/top-level/);
    expect(() => updateCategory(db, fees, { kind: 'income' })).toThrow(/expense/);
  });
});

describe('deleting a category in use', () => {
  it('moves its transactions and budgets to another category, merging clashing budgets', async () => {
    const { category, tx, db, personal } = await setup();
    const travel = category('Travel');
    const trips = category('Trips');
    tx({ categoryId: travel, date: '2026-09-02' });
    tx({ categoryId: travel, date: '2026-09-09' });
    db.insert(budgets)
      .values([
        { id: 'usd', ledgerId: personal, categoryId: travel, currency: 'USD', amount: '100', period: 'monthly' },
        { id: 'pkr', ledgerId: personal, categoryId: travel, currency: 'PKR', amount: '5000', period: 'monthly' },
        { id: 'keep', ledgerId: personal, categoryId: trips, currency: 'USD', amount: '300', period: 'monthly' },
      ])
      .run();

    expect(categoryDeletionImpact(db, travel)).toMatchObject({ count: 2, firstDate: '2026-09-02' });
    deleteCategory(db, travel, { mode: 'move', targetCategoryId: trips });

    expect(db.select().from(transactions).where(eq(transactions.categoryId, trips)).all()).toHaveLength(2);
    const left = db.select().from(budgets).all().map((b) => [b.id, b.categoryId]);
    expect(left.sort()).toEqual([
      ['keep', trips],
      ['pkr', trips],
    ]);
  });

  it('only moves into a category of the same kind', async () => {
    const { category, db } = await setup();
    const travel = category('Travel');
    const salary = category('Salary', 'income');
    expect(() => deleteCategory(db, travel, { mode: 'move', targetCategoryId: salary })).toThrow(/same kind/);
  });

  it('asks for subcategories to go first', async () => {
    const { category, db } = await setup();
    const parent = category('Consulting income', 'income');
    category('Retainer', 'income', parent);
    expect(() => deleteCategory(db, parent, { mode: 'delete_with_transactions' })).toThrow(/subcategories/);
  });

  it('can delete it with its transactions', async () => {
    const { category, tx, db } = await setup();
    const travel = category('Travel');
    tx({ categoryId: travel });
    tx({});
    deleteCategory(db, travel, { mode: 'delete_with_transactions' });
    expect(db.select().from(transactions).all()).toHaveLength(1);
    expect(db.select().from(categories).where(eq(categories.id, travel)).get()).toBeUndefined();
  });
});
