import { eq } from 'drizzle-orm';
import { useLocalSearchParams } from 'expo-router';

import { PersonForm } from '@/components/forms/PersonForm';
import { people } from '@/db/schema';
import { useLive } from '@/state/live';

/** The person page. Per-currency balances, history and Mark as settled arrive with build layer 5. */
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const person = useLive((db) => db.select().from(people).where(eq(people.id, id)).get(), [id]);
  return person ? <PersonForm key={person.id} person={person} /> : null;
}
