import { eq } from 'drizzle-orm';
import { useLocalSearchParams } from 'expo-router';

import { AccountForm } from '@/components/forms/AccountForm';
import { accounts } from '@/db/schema';
import { useLive } from '@/state/live';

export default function EditAccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const account = useLive((db) => db.select().from(accounts).where(eq(accounts.id, id)).get(), [id]);
  return account ? <AccountForm key={account.id} account={account} /> : null;
}
