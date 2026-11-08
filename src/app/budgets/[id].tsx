import { eq } from 'drizzle-orm';
import { useLocalSearchParams } from 'expo-router';

import { BudgetForm } from '@/components/forms/BudgetForm';
import { budgets } from '@/db/schema';
import { useLive } from '@/state/live';

export default function EditBudgetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const budget = useLive((d) => d.select().from(budgets).where(eq(budgets.id, id)).get(), [id]);
  return budget ? <BudgetForm key={budget.id} budget={budget} /> : null;
}
