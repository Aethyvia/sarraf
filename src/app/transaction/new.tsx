import { eq, isNull } from 'drizzle-orm';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { TransactionForm } from '@/components/transaction/TransactionForm';
import { draftFromTransaction } from '@/data/transactions';
import { db } from '@/db/client';
import { accounts, ledgers } from '@/db/schema';
import { today } from '@/lib/dates';
import { useLive } from '@/state/live';
import { formFromDraft, initialForm, type FormKind } from '@/state/transaction-form';

/** Add transaction. Opens on the account it was started from (Account detail), or the first account. */
export default function AddTransactionScreen() {
  const { kind, accountId, duplicate } = useLocalSearchParams<{ kind?: FormKind; accountId?: string; duplicate?: string }>();
  const defaults = useLive((db) => ({
    ledgerId: db.select({ id: ledgers.id }).from(ledgers).where(eq(ledgers.isDefault, true)).get()?.id ?? null,
    accountId: accountId ?? db.select({ id: accounts.id }).from(accounts).where(isNull(accounts.archivedAt)).orderBy(accounts.rank).get()?.id ?? null,
  }));
  // Duplicate (Decided): the same details, ready to change and save as a new transaction dated today.
  const [initial] = useState(() =>
    duplicate
      ? { ...formFromDraft(draftFromTransaction(db, duplicate)), date: today(), status: 'cleared' as const, expectedDate: null }
      : initialForm({ date: today(), ledgerId: defaults.ledgerId, accountId: defaults.accountId, kind }),
  );
  return <TransactionForm initial={initial} />;
}
