import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { TransactionForm } from '@/components/transaction/TransactionForm';
import { db } from '@/db/client';
import { draftFromTransaction } from '@/data/transactions';
import { today } from '@/lib/dates';
import { formFromDraft } from '@/state/transaction-form';

/**
 * Edit a transaction: the same Add transaction screen, filled in.
 * `confirm=1` is "Edit and add transaction" from Needs review: saving it confirms
 * the item (Cleared, dated today unless changed).
 */
export default function EditTransactionScreen() {
  const { id, confirm } = useLocalSearchParams<{ id: string; confirm?: string }>();
  const [initial] = useState(() => {
    const form = formFromDraft(draftFromTransaction(db, id));
    return confirm === '1' ? { ...form, status: 'cleared' as const, date: form.date > today() ? form.date : today(), expectedDate: null } : form;
  });
  return <TransactionForm initial={initial} editId={id} />;
}
