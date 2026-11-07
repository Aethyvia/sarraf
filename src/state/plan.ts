import type { Plan } from '@/data/limits';

/**
 * The user's plan. Sarraf Plus purchases and the cached Supabase subscription
 * arrive with build layer 9; until then everyone is on Free.
 */
export function usePlan(): Plan {
  return 'free';
}
