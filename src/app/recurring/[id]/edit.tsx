import { eq } from 'drizzle-orm';
import { useLocalSearchParams } from 'expo-router';

import { RecurringForm } from '@/components/forms/RecurringForm';
import { recurringItems } from '@/db/schema';
import { useLive } from '@/state/live';

export default function EditRecurringScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useLive((d) => d.select().from(recurringItems).where(eq(recurringItems.id, id)).get(), [id]);
  return item ? <RecurringForm key={item.id} item={item} /> : null;
}
