import { and, eq } from 'drizzle-orm';

import { categories } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { createCategory, type CategoryKind } from './categories';

/**
 * Common categories a new user starts with (owner, Nov 12): top-level ones
 * with sensible subcategories. Everything can be renamed, archived or deleted.
 */
export const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind; icon: string; color: string; subs?: [name: string, icon: string][] }[] = [
  { name: 'Food', kind: 'expense', icon: 'utensils', color: 'orange', subs: [['Groceries', 'basket'], ['Vegetables', 'carrot'], ['Fruits', 'apple'], ['Meat', 'beef'], ['Eating out', 'utensils'], ['Fast food', 'pizza'], ['Snacks & drinks', 'glass']] },
  { name: 'Home', kind: 'expense', icon: 'home', color: 'teal', subs: [['Rent', 'key'], ['Repairs', 'tool'], ['Furniture', 'sofa'], ['Household items', 'package']] },
  { name: 'Bills & utilities', kind: 'expense', icon: 'bulb', color: 'gold', subs: [['Electricity', 'zap'], ['Gas', 'flame'], ['Water', 'drop'], ['Internet', 'wifi'], ['Mobile', 'phone']] },
  { name: 'Transport', kind: 'expense', icon: 'car', color: 'blue', subs: [['Fuel', 'fuel'], ['Ride-hailing', 'taxi'], ['Public transport', 'bus'], ['Parking', 'parking'], ['Car maintenance', 'tool']] },
  { name: 'Shopping', kind: 'expense', icon: 'bag', color: 'pink', subs: [['Clothes', 'shirt'], ['Electronics', 'laptop'], ['Personal care', 'sparkles']] },
  { name: 'Health', kind: 'expense', icon: 'heart', color: 'pink', subs: [['Doctor', 'stethoscope'], ['Medicine', 'pill'], ['Tests', 'activity']] },
  { name: 'Education', kind: 'expense', icon: 'graduation', color: 'purple', subs: [['School fees', 'school'], ['Books', 'book'], ['Courses', 'graduation']] },
  { name: 'Family', kind: 'expense', icon: 'family', color: 'orange', subs: [['Kids', 'baby'], ['Support to family', 'heart-handshake']] },
  { name: 'Entertainment', kind: 'expense', icon: 'film', color: 'purple', subs: [['Streaming', 'tv'], ['Outings', 'ticket'], ['Games', 'gamepad']] },
  { name: 'Travel', kind: 'expense', icon: 'plane', color: 'cyan', subs: [['Flights', 'plane'], ['Hotels', 'hotel']] },
  { name: 'Work & software', kind: 'expense', icon: 'laptop', color: 'blue', subs: [['Software & subscriptions', 'cloud'], ['Equipment', 'printer'], ['Co-working', 'office']] },
  { name: 'Charity', kind: 'expense', icon: 'charity', color: 'teal', subs: [['Zakat', 'hand-coins'], ['Sadaqah', 'charity']] },
  { name: 'Gifts', kind: 'expense', icon: 'gift', color: 'gold' },
  { name: 'Salary', kind: 'income', icon: 'work', color: 'teal' },
  { name: 'Freelance', kind: 'income', icon: 'laptop', color: 'blue', subs: [['Client work', 'handshake'], ['Retainers', 'cycle']] },
  { name: 'Business', kind: 'income', icon: 'store', color: 'purple' },
  { name: 'Gifts received', kind: 'income', icon: 'gift', color: 'gold' },
  { name: 'Profit & interest', kind: 'income', icon: 'trend', color: 'cyan' },
  { name: 'Other income', kind: 'income', icon: 'coins', color: 'neutral' },
];

/** Adds the defaults when the user has no categories of their own yet (only the built-in Fees & charges). */
export function addDefaultCategories(db: AppDb): number {
  const own = db.select({ id: categories.id }).from(categories).where(and(eq(categories.isSystem, false))).get();
  if (own) return 0;
  let n = 0;
  for (const c of DEFAULT_CATEGORIES) {
    const parentId = createCategory(db, { name: c.name, kind: c.kind, icon: c.icon, color: c.color });
    n += 1;
    for (const [sub, icon] of c.subs ?? []) {
      createCategory(db, { name: sub, kind: c.kind, parentId, icon, color: c.color });
      n += 1;
    }
  }
  return n;
}
