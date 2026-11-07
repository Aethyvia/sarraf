import { useLocalSearchParams } from 'expo-router';

import { CategoryForm } from '@/components/forms/CategoryForm';

export default function AddCategoryScreen() {
  const { kind, parent } = useLocalSearchParams<{ kind?: 'expense' | 'income'; parent?: string }>();
  return <CategoryForm initialKind={kind === 'income' ? 'income' : 'expense'} initialParentId={parent ?? null} />;
}
