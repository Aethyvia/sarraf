import { effectivePlan, refreshPlan } from '../plan';
import { fakeCloud, memoryStore } from '@/services/cloud/fake';
import { setup } from '@/test/factories';
describe('lifetime Plus for supporters (owner, Nov 14)', () => {
  it('a code gives Plus that never runs out, even offline for years', async () => {
    const s = await setup();
    const cloud = fakeCloud(memoryStore());
    const user = { id: 'dev-user', email: 'dev@sarraf.local', method: 'dev' as const };
    expect(await cloud.redeemCode(user, 'nope')).toBe('unknown');
    expect(await cloud.redeemCode(user, 'sarraf-test')).toBe('ok');
    expect(await cloud.redeemCode(user, 'SARRAF-TEST')).toBe('used');
    expect(await refreshPlan(s.db, cloud, user, new Date('2026-11-14T00:00:00Z'))).toBe('plus');
    expect(effectivePlan(s.db, new Date('2040-01-01T00:00:00Z'))).toBe('plus');
  });
});
