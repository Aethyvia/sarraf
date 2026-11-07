import { eq } from 'drizzle-orm';
import { useLocalSearchParams } from 'expo-router';

import { CategoryForm } from '@/components/forms/CategoryForm';
import { categories } from '@/db/schema';
import { useLive } from '@/state/live';

export default function EditCategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const category = useLive((db) => db.select().from(categories).where(eq(categories.id, id)).get(), [id]);
  return category ? <CategoryForm key={category.id} category={category} /> : null;
}
