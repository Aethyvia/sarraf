import { ensureBaseData } from '@/db/base-data';
import { buildSampleData } from '@/db/sample';
import { accounts, deviceState, settings } from '@/db/schema';
import { fakeCloud, grantFakePlus, memoryStore } from '@/services/cloud/fake';
import { createTestDb } from '@/test/db';
import { backupNow, currentUser, getDeviceState, lookInDrive, memoryKeyStore, rememberSignIn, turnOnBackup } from '../backup-flow';
import { effectivePlan, refreshPlan } from '../plan';
import { clearSignedOut, deleteChosen, isSignedOut, signOut } from '../sarraf-account';

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
  it('signing out takes the data off this phone; the Drive backup stays and restores on the next sign-in (owner, Nov 14)', async () => {
    const store = memoryStore();
    const p = await phone(store);
    await turnOnBackup(p, 'pw-12345678');
    expect(await backupNow(p)).toMatchObject({ ok: true });
    let filesGone = false;
    await signOut(p, { removeData: true, deleteFiles: () => (filesGone = true), now: '2026-11-14T00:00:00Z' });
    expect(filesGone).toBe(true);
    expect(p.db.select().from(accounts).all()).toHaveLength(0);
    expect(currentUser(p.db)).toBeNull();
    expect(await p.keyStore.get()).toBeNull();
    expect(await p.cloud.findBackup()).not.toBeNull();
  });

  it('unticked, signing out keeps the data, pauses backups, and signing in again carries on', async () => {
    const p = await phone();
    await turnOnBackup(p, 'pw-12345678');
    await signOut(p, { removeData: false, deleteFiles: () => {}, now: '2026-10-01T00:00:00Z' });
    expect(isSignedOut(p.db)).toBe(true);
    expect(p.db.select().from(accounts).all()).toHaveLength(6);
    expect(await backupNow(p)).toEqual({ ok: false, reason: 'signed_out' });
    rememberSignIn(p.db, await p.cloud.signIn('google'));
    clearSignedOut(p.db);
    expect(isSignedOut(p.db)).toBe(false);
    expect(await backupNow(p)).toMatchObject({ ok: true });
  });

  const NOW = { now: '2026-11-12T00:00:00Z' };
  const everything = { account: true, phone: true, drive: false };

  it('deleting the Sarraf account takes this phone’s data and the Drive backup with it (owner, Nov 14)', async () => {
    const store = memoryStore();
    const p = await phone(store);
    await turnOnBackup(p, 'pw-12345678');
    await backupNow(p);
    let filesGone = false;
    await deleteChosen(p, { account: true, phone: false, drive: false }, { ...NOW, deleteFiles: () => (filesGone = true) });
    expect(filesGone).toBe(true);
    expect(p.db.select().from(accounts).all()).toHaveLength(0);
    expect(p.db.select().from(deviceState).get()!.userId).toBeNull();
    expect(await p.keyStore.get()).toBeNull();
    expect(await p.cloud.getRecord({ id: 'dev-user', email: '', method: 'dev' })).toBeNull();
    expect((await lookInDrive(p)).header).toBeNull();
  });

  it('this phone’s data, signing out too: erased and signed out; the backup stays', async () => {
    const p = await phone();
    await turnOnBackup(p, 'pw-12345678');
    await backupNow(p);
    await deleteChosen(p, { account: false, phone: true, drive: false, signOut: true }, { ...NOW, deleteFiles: () => {} });
    expect(p.db.select().from(accounts).all()).toHaveLength(0);
    expect(currentUser(p.db)).toBeNull();
    expect((await lookInDrive(p)).header).not.toBeNull();
  });

  it('delete this phone’s data only: still signed in, the account and backup stay', async () => {
    const p = await phone();
    await turnOnBackup(p, 'pw-12345678');
    await backupNow(p);
    await deleteChosen(p, { account: false, phone: true, drive: false }, { ...NOW, deleteFiles: () => {} });
    expect(p.db.select().from(accounts).all()).toHaveLength(0);
    expect(currentUser(p.db)?.id).toBe('dev-user');
    expect(await p.cloud.getRecord(currentUser(p.db)!)).not.toBeNull();
  });

  it('erasing this phone keeps its device id (its own backup stays its own)', async () => {
    const p = await phone();
    const before = p.db.select().from(settings).get()!.deviceId;
    await deleteChosen(p, { account: false, phone: true, drive: false }, { ...NOW, deleteFiles: () => {} });
    expect(p.db.select().from(settings).get()!.deviceId).toBe(before);
  });

  it('delete the Drive backup only, keep backing up: the old one goes and the next backup is a new one', async () => {
    const p = await phone();
    await turnOnBackup(p, 'pw-12345678');
    await backupNow(p);
    await deleteChosen(p, { account: false, phone: false, drive: true, keepBackingUp: true }, { ...NOW, deleteFiles: () => {} });
    expect(getDeviceState(p.db)).toMatchObject({ backupEnabled: true, lastBackupAt: null });
    expect((await lookInDrive(p)).header).toBeNull();
    expect(await backupNow(p)).toMatchObject({ ok: true });
    expect((await lookInDrive(p)).header).not.toBeNull();
  });

  it('delete the Drive backup only, turn backup off: the record goes too and backup turns off here', async () => {
    const p = await phone();
    await turnOnBackup(p, 'pw-12345678');
    await backupNow(p);
    await deleteChosen(p, { account: false, phone: false, drive: true }, { ...NOW, deleteFiles: () => {} });
    expect(p.db.select().from(accounts).all()).toHaveLength(6);
    expect(await p.cloud.getRecord(currentUser(p.db)!)).toBeNull();
    expect(getDeviceState(p.db).backupEnabled).toBe(false);
    expect((await lookInDrive(p)).header).toBeNull();
  });
});
