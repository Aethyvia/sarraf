import { currentUser } from '@/data/backup-flow';
import { refreshPlan } from '@/data/plan';
import { db } from '@/db/client';
import { cloud } from './cloud';

/**
 * Sarraf Plus. Until Google Play Billing is wired up (owner, Nov 12), Subscribe
 * records the subscription on the user's Sarraf account directly (Supabase
 * `test_subscribe`), then the plan is read back like any other.
 */
export const store = {
  get ready() {
    return cloud.ready;
  },
  async purchase(kind: 'monthly' | 'yearly'): Promise<boolean> {
    const user = currentUser(db);
    if (!user) return false;
    await cloud.testSubscribe(user, kind);
    return (await refreshPlan(db, cloud, user, new Date())) === 'plus';
  },
  /** "Have a code?": a supporter code (owner, Nov 14). Needs a Sarraf account. */
  async redeem(code: string): Promise<'ok' | 'used' | 'expired' | 'unknown' | 'signIn'> {
    const user = currentUser(db);
    if (!user) return 'signIn';
    const r = await cloud.redeemCode(user, code);
    if (r === 'ok') await refreshPlan(db, cloud, user, new Date());
    return r;
  },
  async restore(): Promise<boolean> {
    const user = currentUser(db);
    if (!user || !cloud.ready) return false;
    return (await refreshPlan(db, cloud, user, new Date())) === 'plus';
  },
};
