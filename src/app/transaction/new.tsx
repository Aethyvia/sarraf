import { eq, isNull } from 'drizzle-orm';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { TransactionForm } from '@/components/transaction/TransactionForm';
import { recurringDraft } from '@/data/recurring';
import { draftFromTransaction } from '@/data/transactions';
import { db } from '@/db/client';
import { accounts, ledgers, recurringItems } from '@/db/schema';
import { today } from '@/lib/dates';
import { useLive } from '@/state/live';
import { formFromDraft, initialForm, type FormKind } from '@/state/transaction-form';

/** Add transaction. Opens on the account it was started from (Account detail), or the first account. */
export default function AddTransactionScreen() {
  const { kind, accountId, duplicate, recurring, goal } = useLocalSearchParams<{ kind?: FormKind; accountId?: string; duplicate?: string; recurring?: string; goal?: string }>();
  const defaults = useLive((db) => ({
    ledgerId: db.select({ id: ledgers.id }).from(ledgers).where(eq(ledgers.isDefault, true)).get()?.id ?? null,
    accountId: accountId ?? db.select({ id: accounts.id }).from(accounts).where(isNull(accounts.archivedAt)).orderBy(accounts.rank).get()?.id ?? null,
  }));
  // Duplicate (Decided): the same details, ready to change and save as a new transaction dated today.
  // Pay / Add from a recurring item (Decided): Add transaction pre-filled; a bill's amount starts empty.
  const [initial] = useState(() => {
    if (duplicate) {
      return { ...formFromDraft(draftFromTransaction(db, duplicate)), date: today(), status: 'cleared' as const, expectedDate: null, recurringId: null, recurringDueDate: null };
    }
    const item = recurring ? db.select().from(recurringItems).where(eq(recurringItems.id, recurring)).get() : undefined;
    if (item) {
      const form = formFromDraft(recurringDraft(item, today()));
      return item.amountType === 'varies' ? { ...form, expression: '' } : form;
    }
    const form = initialForm({ date: today(), ledgerId: defaults.ledgerId, accountId: defaults.accountId, kind });
    // Add money from a goal page: Savings, on that goal.
    return goal ? { ...form, kind: 'savings' as const, goalId: goal } : form;
  });
  return <TransactionForm initial={initial} />;
}
