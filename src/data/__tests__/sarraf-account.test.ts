import { ensureBaseData } from '@/db/base-data';
import { buildSampleData } from '@/db/sample';
import { accounts, deviceState } from '@/db/schema';
import { fakeCloud, grantFakePlus, memoryStore } from '@/services/cloud/fake';
import { createTestDb } from '@/test/db';
import { backupNow, currentUser, lookInDrive, memoryKeyStore, rememberSignIn, turnOnBackup } from '../backup-flow';
import { effectivePlan, refreshPlan } from '../plan';
import { clearSignedOut, deleteSarrafAccount, isSignedOut, signOut } from '../sarraf-account';

jest.setTimeout(30000);

async function phone(store = memoryStore()) {
  const db = await createTestDb();
  ensureBaseData(db);
  db.transaction((tx) => buildSampleData(tx));
  const cloud = fakeCloud(store);
  const deps = { db, cloud, keyStore: memoryKeyStore(), deviceName: 'Pixel 7' };
  rememberSignIn(db, await cloud.signIn('google'));
  return { ...deps, store };
}

describe('plan', () => {
  it('Plus from the subscription, kept 7 days past renewal offline, then Free', async () => {
    const p = await phone();
    expect(effectivePlan(p.db, new Date())).toBe('free');
    grantFakePlus(p.store, '2026-10-30T00:00:00.000Z');
    expect(await refreshPlan(p.db, p.cloud, currentUser(p.db)!, new Date('2026-10-01T00:00:00Z'))).toBe('plus');
    expect(effectivePlan(p.db, new Date('2026-11-05T00:00:00Z'))).toBe('plus');
    expect(effectivePlan(p.db, new Date('2026-11-07T00:00:01Z'))).toBe('free');
  });
});

describe('sign out and delete', () => {
  it('signing out keeps the data, pauses backups, and signing in again carries on', async () => {
    const p = await phone();
    await turnOnBackup(p, 'pw-12345678');
    await signOut(p, '2026-10-01T00:00:00Z');
    expect(isSignedOut(p.db)).toBe(true);
    expect(p.db.select().from(accounts).all()).toHaveLength(6);
    expect(await backupNow(p)).toEqual({ ok: false, reason: 'signed_out' });
    rememberSignIn(p.db, await p.cloud.signIn('google'));
    clearSignedOut(p.db);
    expect(isSignedOut(p.db)).toBe(false);
    expect(await backupNow(p)).toMatchObject({ ok: true });
  });

  it('delete removes the account, the record and everything here; the Drive backup only if ticked', async () => {
    const store = memoryStore();
    const p = await phone(store);
    await turnOnBackup(p, 'pw-12345678');
    await backupNow(p);
    let filesGone = false;
    await deleteSarrafAccount(p, { deleteDriveBackup: false, deleteFiles: () => (filesGone = true) });
    expect(filesGone).toBe(true);
    expect(p.db.select().from(accounts).all()).toHaveLength(0);
    expect(p.db.select().from(deviceState).get()!.userId).toBeNull();
    expect(await p.keyStore.get()).toBeNull();
    expect(await p.cloud.getRecord({ id: 'dev-user', email: '', method: 'dev' })).toBeNull();
    // The Drive backup was kept.
    expect((await lookInDrive(p)).header).not.toBeNull();

    const q = await phone(store);
    await deleteSarrafAccount(q, { deleteDriveBackup: true, deleteFiles: () => {} });
    expect((await lookInDrive(q)).header).toBeNull();
  });
});
