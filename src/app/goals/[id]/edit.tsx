import { eq } from 'drizzle-orm';
import { useLocalSearchParams } from 'expo-router';

import { GoalForm } from '@/components/forms/GoalForm';
import { savingsGoals } from '@/db/schema';
import { useLive } from '@/state/live';

export default function EditGoalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goal = useLive((d) => d.select().from(savingsGoals).where(eq(savingsGoals.id, id)).get(), [id]);
  return goal ? <GoalForm key={goal.id} goal={goal} /> : null;
}
