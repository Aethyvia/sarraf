import { useLocalSearchParams } from 'expo-router';

import { BudgetForm } from '@/components/forms/BudgetForm';

export default function NewBudgetScreen() {
  const { ledger } = useLocalSearchParams<{ ledger?: string }>();
  return <BudgetForm ledgerId={ledger} />;
}
