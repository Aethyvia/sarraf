import { eq, isNull } from 'drizzle-orm';
import { useLocalSearchParams } from 'expo-router';

import { TransactionForm } from '@/components/transaction/TransactionForm';
import { accounts, ledgers } from '@/db/schema';
import { today } from '@/lib/dates';
import { useLive } from '@/state/live';
import { initialForm, type FormKind } from '@/state/transaction-form';

/** Add transaction. Opens on the account it was started from (Account detail), or the first account. */
export default function AddTransactionScreen() {
  const { kind, accountId } = useLocalSearchParams<{ kind?: FormKind; accountId?: string }>();
  const defaults = useLive((db) => ({
    ledgerId: db.select({ id: ledgers.id }).from(ledgers).where(eq(ledgers.isDefault, true)).get()?.id ?? null,
    accountId: accountId ?? db.select({ id: accounts.id }).from(accounts).where(isNull(accounts.archivedAt)).orderBy(accounts.rank).get()?.id ?? null,
  }));
  return <TransactionForm initial={initialForm({ date: today(), ledgerId: defaults.ledgerId, accountId: defaults.accountId, kind })} />;
}
