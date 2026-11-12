import { and, eq } from 'drizzle-orm';

import { categories } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { createCategory, type CategoryKind } from './categories';

/**
 * Common categories a new user starts with (owner, Nov 12): top-level ones
 * with sensible subcategories. Everything can be renamed, archived or deleted.
 */
export const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind; icon: string; color: string; subs?: string[] }[] = [
  { name: 'Food', kind: 'expense', icon: 'basket', color: 'orange', subs: ['Groceries', 'Vegetables', 'Fruits', 'Meat', 'Eating out', 'Fast food', 'Snacks & drinks'] },
  { name: 'Home', kind: 'expense', icon: 'home', color: 'teal', subs: ['Rent', 'Repairs', 'Furniture', 'Household items'] },
  { name: 'Bills & utilities', kind: 'expense', icon: 'bulb', color: 'gold', subs: ['Electricity', 'Gas', 'Water', 'Internet', 'Mobile'] },
  { name: 'Transport', kind: 'expense', icon: 'car', color: 'blue', subs: ['Fuel', 'Ride-hailing', 'Public transport', 'Parking', 'Car maintenance'] },
  { name: 'Shopping', kind: 'expense', icon: 'bag', color: 'pink', subs: ['Clothes', 'Electronics', 'Personal care'] },
  { name: 'Health', kind: 'expense', icon: 'heart', color: 'pink', subs: ['Doctor', 'Medicine', 'Tests'] },
  { name: 'Education', kind: 'expense', icon: 'school', color: 'purple', subs: ['School fees', 'Books', 'Courses'] },
  { name: 'Family', kind: 'expense', icon: 'family', color: 'orange', subs: ['Kids', 'Support to family'] },
  { name: 'Entertainment', kind: 'expense', icon: 'tv', color: 'purple', subs: ['Streaming', 'Outings', 'Games'] },
  { name: 'Travel', kind: 'expense', icon: 'suitcase', color: 'cyan', subs: ['Flights', 'Hotels'] },
  { name: 'Work & software', kind: 'expense', icon: 'laptop', color: 'blue', subs: ['Software & subscriptions', 'Equipment', 'Co-working'] },
  { name: 'Charity', kind: 'expense', icon: 'charity', color: 'teal', subs: ['Zakat', 'Sadaqah'] },
  { name: 'Gifts', kind: 'expense', icon: 'star', color: 'gold' },
  { name: 'Salary', kind: 'income', icon: 'work', color: 'teal' },
  { name: 'Freelance', kind: 'income', icon: 'briefcase', color: 'blue', subs: ['Client work', 'Retainers'] },
  { name: 'Business', kind: 'income', icon: 'office', color: 'purple' },
  { name: 'Gifts received', kind: 'income', icon: 'star', color: 'gold' },
  { name: 'Profit & interest', kind: 'income', icon: 'percent', color: 'cyan' },
  { name: 'Other income', kind: 'income', icon: 'dollar', color: 'neutral' },
];

/** Adds the defaults when the user has no categories of their own yet (only the built-in Fees & charges). */
export function addDefaultCategories(db: AppDb): number {
  const own = db.select({ id: categories.id }).from(categories).where(and(eq(categories.isSystem, false))).get();
  if (own) return 0;
  let n = 0;
  for (const c of DEFAULT_CATEGORIES) {
    const parentId = createCategory(db, { name: c.name, kind: c.kind, icon: c.icon, color: c.color });
    n += 1;
    for (const sub of c.subs ?? []) {
      createCategory(db, { name: sub, kind: c.kind, parentId, icon: c.icon, color: c.color });
      n += 1;
    }
  }
  return n;
}
