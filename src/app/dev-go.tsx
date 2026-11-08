import { eq, like } from 'drizzle-orm';
import { Redirect, useLocalSearchParams, type Href } from 'expo-router';

import { db } from '@/db/client';
import { accounts, categories, ledgers, people, recurringItems, savingsGoals, transactions } from '@/db/schema';

/**
 * Dev builds only: opens a record by name so screens can be deep-linked for
 * side-by-side checks against the design boards, e.g.
 * /dev-go?to=account&name=Payoneer%20USD&then=edit
 */
export default function DevGo() {
  const { to, name, then } = useLocalSearchParams<{ to: string; name: string; then?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  const find = (): string | undefined => {
    switch (to) {
      case 'account':
        return db.select().from(accounts).where(eq(accounts.name, name)).get()?.id;
      case 'person':
        return db.select().from(people).where(eq(people.name, name)).get()?.id;
      case 'goal':
        return db.select().from(savingsGoals).where(eq(savingsGoals.name, name)).get()?.id;
      case 'ledger':
        return db.select().from(ledgers).where(eq(ledgers.name, name)).get()?.id;
      case 'category':
        return db.select().from(categories).where(eq(categories.name, name)).get()?.id;
      case 'recurring':
        return db.select().from(recurringItems).where(eq(recurringItems.name, name)).get()?.id;
      case 'transaction':
        return db.select().from(transactions).where(like(transactions.notes, `${name}%`)).get()?.id;
    }
  };
  const id = find();
  const base: Record<string, string> = {
    account: '/accounts',
    person: '/people',
    goal: '/goals',
    ledger: '/ledgers',
    category: '/categories',
    recurring: '/recurring',
    transaction: '/transaction',
  };
  if (!id) return <Redirect href="/dev" />;
  const path = to === 'recurring' && !then ? `${base[to]}/${id}/edit` : `${base[to]}/${id}${then ? `/${then}` : ''}`;
  return <Redirect href={path as Href} />;
}
