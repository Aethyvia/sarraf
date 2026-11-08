import { currentUser } from '@/data/backup-flow';
import { refreshPlan } from '@/data/plan';
import { db } from '@/db/client';
import { cloud, devStore } from './cloud';
import { grantFakePlus } from './cloud/fake';

/**
 * In-app purchase of Sarraf Plus (Google Play Billing). Until the store
 * products exist, dev builds use a stand-in that grants Plus for a month;
 * release builds say purchases aren't set up.
 */
export const store = {
  ready: devStore !== null,
  async purchase(kind: 'monthly' | 'yearly'): Promise<boolean> {
    const user = currentUser(db);
    if (!devStore || !user) return false;
    const renews = new Date(Date.now() + (kind === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString();
    grantFakePlus(devStore, renews);
    return (await refreshPlan(db, cloud, user, new Date())) === 'plus';
  },
  async restore(): Promise<boolean> {
    const user = currentUser(db);
    if (!user || !cloud.ready) return false;
    return (await refreshPlan(db, cloud, user, new Date())) === 'plus';
  },
};
