import type { Plan } from '@/data/limits';
import { effectivePlan } from '@/data/plan';
import { useLive } from './live';

/** The plan limits are checked against: the cached Sarraf Plus subscription, with a 7-day grace. */
export function usePlan(): Plan {
  return useLive((db) => effectivePlan(db, new Date()), []);
}
