import { eq } from 'drizzle-orm';

import { ensureBaseData } from '@/db/base-data';
import { buildSampleData } from '@/db/sample';
import { deviceState, settings } from '@/db/schema';
import { createTestDb } from '@/test/db';
import { planNotifications } from '../reminders';

async function sample() {
  const db = await createTestDb();
  ensureBaseData(db);
  buildSampleData(db);
  return db;
}
const NOW = { date: '2026-09-30', time: '12:00' };

describe('planned notifications', () => {
  it('reminds about recurring items on their Show on Home day and late expected money', async () => {
    const db = await sample();
    const plan = planNotifications(db, NOW);
    expect(plan.map((n) => [n.at, n.title])).toEqual([
      ['2026-10-15T09:00', 'Upwork payout expected yesterday'],
      ['2026-10-22T08:30', 'Netflix is due in 7 days'],
    ]);
    expect(plan[0].body).toBe('$500.00 to Payoneer USD · mark received?');
    // Past reminders (Internet, Electricity, Adobe showed from Sep 26–29) aren't scheduled.
  });

  it('includes transfers in transit only when turned on, and never shows amounts while hidden', async () => {
    const db = await sample();
    db.update(settings).set({ notifyInTransit: true, hideAmounts: true }).where(eq(settings.id, 1)).run();
    const plan = planNotifications(db, { date: '2026-09-28', time: '08:00' });
    expect(plan.find((n) => n.key.startsWith('transit:'))).toMatchObject({ at: '2026-09-29T09:00', body: 'Payoneer USD → Alfalah PKR · sent 3 days ago' });
    expect(plan.find((n) => n.key.startsWith('late:'))?.body).toBe('To Payoneer USD · mark received?');
    expect(plan.every((n) => !/\d+\.\d\d/.test(n.body))).toBe(true);
  });

  it('respects each switch', async () => {
    const db = await sample();
    db.update(settings).set({ notifyRecurringDue: false, notifyExpectedLate: false }).where(eq(settings.id, 1)).run();
    expect(planNotifications(db, NOW)).toEqual([]);
  });
});

describe('backup problem notifications', () => {
  it('after 3 days of failed automatic backups, only while backup is on here', async () => {
    const db = await createTestDb();
    ensureBaseData(db);
    const backupNote = () => planNotifications(db, { date: '2026-10-01', time: '08:00' }).filter((n) => n.key.startsWith('backup-failing'));
    expect(backupNote()).toEqual([]);
    db.update(deviceState).set({ backupEnabled: true, backupFailingSince: '2026-10-01T05:00:00.000Z' }).where(eq(deviceState.id, 1)).run();
    expect(backupNote()).toEqual([expect.objectContaining({ at: '2026-10-04T09:00', route: '/backup', title: 'Backups haven’t worked for 3 days' })]);
    db.update(deviceState).set({ backupMovedAt: '2026-10-02T00:00:00.000Z' }).where(eq(deviceState.id, 1)).run();
    expect(backupNote()).toEqual([]);
    db.update(deviceState).set({ backupMovedAt: null }).where(eq(deviceState.id, 1)).run();
    db.update(settings).set({ notifyBackupProblems: false }).where(eq(settings.id, 1)).run();
    expect(backupNote()).toEqual([]);
  });
});
