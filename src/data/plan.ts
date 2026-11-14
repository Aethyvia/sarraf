import { eq } from 'drizzle-orm';

import { deviceState } from '@/db/schema';
import type { AppDb } from '@/db/types';
import type { Cloud, CloudUser } from '@/services/cloud/types';
import type { Plan } from './limits';

/** Plan status is cached for offline limit checks, with a 7-day grace (Spec, Ideas added Nov 7). */
export const GRACE_DAYS = 7;
/** Lifetime Plus (Patreon supporters, owner Nov 14) is stored as never renewing: it works offline for good. */
export const LIFETIME = '9999-12-31T00:00:00.000Z';
export const isLifetime = (renewsAt: string | null | undefined) => !!renewsAt && renewsAt.startsWith('9999');
const DAY = 24 * 60 * 60 * 1000;

/** The plan to enforce now: Plus until its renewal date plus the grace, else Free. */
export function effectivePlan(db: AppDb, now: Date): Plan {
  const s = db.select().from(deviceState).where(eq(deviceState.id, 1)).get();
  if (!s || s.plan !== 'plus') return 'free';
  const until = s.planRenewsAt ?? s.planCheckedAt;
  if (!until) return 'plus';
  return now.getTime() <= new Date(until).getTime() + GRACE_DAYS * DAY ? 'plus' : 'free';
}

/** Refreshes the cached plan from the subscription on record (on app open, after a purchase). */
export async function refreshPlan(db: AppDb, cloud: Cloud, user: CloudUser, now: Date): Promise<Plan> {
  const sub = await cloud.getSubscription(user);
  db.update(deviceState)
    .set({ plan: sub ? 'plus' : 'free', planRenewsAt: sub?.lifetime ? LIFETIME : (sub?.renewsAt ?? null), planCheckedAt: now.toISOString() })
    .where(eq(deviceState.id, 1))
    .run();
  return effectivePlan(db, now);
}
