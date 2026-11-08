import { eq } from 'drizzle-orm';

import { ensureBaseData } from '@/db/base-data';
import { buildSampleData } from '@/db/sample';
import { attachments, settings } from '@/db/schema';
import { WrongSecretError } from '@/lib/backup-crypto';
import { fakeCloud, memoryStore } from '@/services/cloud/fake';
import { createTestDb } from '@/test/db';
import { snapshot } from '../backup-file';
import {
  addedSince,
  automaticBackupDue,
  backupNow,
  changeBackupPassword,
  getDeviceState,
  lookInDrive,
  makeThisTheBackupPhone,
  memoryKeyStore,
  rememberSignIn,
  renewRecoveryKey,
  restoreFromDrive,
  turnOnBackup,
} from '../backup-flow';

jest.setTimeout(30000);

async function phone(name: string, cloud: ReturnType<typeof fakeCloud>, withSample = false) {
  const db = await createTestDb();
  ensureBaseData(db);
  if (withSample) db.transaction((tx) => buildSampleData(tx));
  db.update(settings).set({ deviceId: `${name}-id` }).where(eq(settings.id, 1)).run();
  const deps = { db, cloud, keyStore: memoryKeyStore(), deviceName: name };
  rememberSignIn(db, await cloud.signIn('google'));
  return deps;
}

describe('backup and restore across phones', () => {
  it('backs up, restores on a new phone with the recovery key, and the old phone stops', async () => {
    const cloud = fakeCloud(memoryStore());
    const old = await phone('Pixel 7', cloud, true);

    const { recoveryKey } = await turnOnBackup(old, 'the password that matters');
    expect(await backupNow(old)).toMatchObject({ ok: true });
    const record = await cloud.getRecord({ id: 'dev-user', email: 'dev@sarraf.local', method: 'dev' });
    expect(record).toMatchObject({ deviceName: 'Pixel 7', deviceId: 'Pixel 7-id', counts: { accounts: 6, ledgers: 2 } });

    const fresh = await phone('Pixel 9', cloud);
    const found = await lookInDrive(fresh);
    expect(found.header).toMatchObject({ deviceName: 'Pixel 7', counts: { accounts: 6 } });

    await expect(restoreFromDrive(fresh, 'wrong')).rejects.toBeInstanceOf(WrongSecretError);
    expect(snapshot(fresh.db).accounts).toHaveLength(0);

    await restoreFromDrive(fresh, recoveryKey.toLowerCase());
    expect(snapshot(fresh.db).transactions).toEqual(snapshot(old.db).transactions);
    expect((await cloud.getRecord({ id: 'dev-user', email: '', method: 'dev' }))?.deviceName).toBe('Pixel 9');

    // The old phone's next backup sees the move and stops, saying where it went.
    expect(await backupNow(old)).toEqual({ ok: false, reason: 'moved', movedTo: 'Pixel 9' });
    expect(getDeviceState(old.db).backupMovedTo).toBe('Pixel 9');
    // The new phone keeps backing up with the same password.
    expect(await backupNow(fresh)).toMatchObject({ ok: true });
    const again = await phone('Pixel 10', cloud);
    await lookInDrive(again);
    await restoreFromDrive(again, 'the password that matters');
    expect(snapshot(again.db).accounts).toHaveLength(6);
  });

  it('start fresh: the old backup stays until this phone makes its first backup', async () => {
    const cloud = fakeCloud(memoryStore());
    const old = await phone('Pixel 7', cloud, true);
    await turnOnBackup(old, 'pw-one');
    await backupNow(old);

    const fresh = await phone('Pixel 9', cloud);
    expect((await lookInDrive(fresh)).header?.deviceName).toBe('Pixel 7');
    await turnOnBackup(fresh, 'pw-two');
    expect(await backupNow(fresh)).toMatchObject({ ok: true });
    expect((await lookInDrive(fresh)).header?.deviceName).toBe('Pixel 9');
  });

  it('an interrupted download changes nothing on the phone', async () => {
    const cloud = fakeCloud(memoryStore());
    const old = await phone('Pixel 7', cloud, true);
    await turnOnBackup(old, 'pw');
    await backupNow(old);
    const fresh = await phone('Pixel 9', cloud);
    await lookInDrive(fresh);
    cloud.knobs.dropDownload = true;
    await expect(restoreFromDrive(fresh, 'pw')).rejects.toThrow();
    expect(snapshot(fresh.db).accounts).toHaveLength(0);
    expect(getDeviceState(fresh.db).backupEnabled).toBe(false);
  });

  it('backup is off until turned on', async () => {
    const cloud = fakeCloud(memoryStore());
    const p = await phone('Pixel 7', cloud);
    expect(await backupNow(p)).toEqual({ ok: false, reason: 'off' });
  });
});

describe('backup settings', () => {
  it('a changed password opens the next backup; the old one no longer does', async () => {
    const cloud = fakeCloud(memoryStore());
    const p = await phone('Pixel 7', cloud, true);
    const { recoveryKey } = await turnOnBackup(p, 'old-password');
    await changeBackupPassword(p, 'new-password');
    await backupNow(p);
    const fresh = await phone('Pixel 9', cloud);
    await lookInDrive(fresh);
    await expect(restoreFromDrive(fresh, 'old-password')).rejects.toBeInstanceOf(WrongSecretError);
    await restoreFromDrive(fresh, recoveryKey);
    expect(snapshot(fresh.db).accounts).toHaveLength(6);
  });

  it('a renewed recovery key replaces the old one with the next backup', async () => {
    const cloud = fakeCloud(memoryStore());
    const p = await phone('Pixel 7', cloud, true);
    const { recoveryKey: oldKey } = await turnOnBackup(p, 'pw-12345678');
    const newKey = await renewRecoveryKey(p);
    await backupNow(p);
    const fresh = await phone('Pixel 9', cloud);
    await lookInDrive(fresh);
    await expect(restoreFromDrive(fresh, oldKey)).rejects.toBeInstanceOf(WrongSecretError);
    await restoreFromDrive(fresh, newKey);
  });

  it('automatic backups: daily or weekly, Wi-Fi only unless turned off, never when manual or moved', async () => {
    const cloud = fakeCloud(memoryStore());
    const p = await phone('Pixel 7', cloud);
    const wifi = { online: true, wifi: true };
    const mobile = { online: true, wifi: false };
    expect(automaticBackupDue(p.db, new Date(), wifi)).toBe(false); // off
    await turnOnBackup(p, 'pw-12345678');
    expect(automaticBackupDue(p.db, new Date(), wifi)).toBe(true); // never backed up
    expect(automaticBackupDue(p.db, new Date(), mobile)).toBe(false); // Wi-Fi only
    p.db.update(settings).set({ backupWifiOnly: false }).where(eq(settings.id, 1)).run();
    expect(automaticBackupDue(p.db, new Date(), mobile)).toBe(true);
    expect(automaticBackupDue(p.db, new Date(), { online: false, wifi: false })).toBe(false);

    await backupNow({ ...p, now: () => '2026-09-01T06:00:00.000Z' });
    expect(automaticBackupDue(p.db, new Date('2026-09-01T20:00:00Z'), wifi)).toBe(false);
    expect(automaticBackupDue(p.db, new Date('2026-09-02T06:00:00Z'), wifi)).toBe(true);
    p.db.update(settings).set({ backupFrequency: 'weekly' }).where(eq(settings.id, 1)).run();
    expect(automaticBackupDue(p.db, new Date('2026-09-05T06:00:00Z'), wifi)).toBe(false);
    expect(automaticBackupDue(p.db, new Date('2026-09-08T06:00:00Z'), wifi)).toBe(true);
    p.db.update(settings).set({ backupFrequency: 'manual' }).where(eq(settings.id, 1)).run();
    expect(automaticBackupDue(p.db, new Date('2026-12-01T06:00:00Z'), wifi)).toBe(false);
  });

  it('a moved phone can take the backup back', async () => {
    const cloud = fakeCloud(memoryStore());
    const old = await phone('Pixel 7', cloud, true);
    await turnOnBackup(old, 'pw-12345678');
    await backupNow(old);
    const fresh = await phone('Pixel 9', cloud);
    await lookInDrive(fresh);
    await restoreFromDrive(fresh, 'pw-12345678');
    expect(await backupNow(old)).toMatchObject({ ok: false, reason: 'moved' });
    expect(automaticBackupDue(old.db, new Date(), { online: true, wifi: true })).toBe(false);
    expect(await makeThisTheBackupPhone(old)).toMatchObject({ ok: true });
    expect((await lookInDrive(fresh)).header?.deviceName).toBe('Pixel 7');
    expect(await backupNow(fresh)).toMatchObject({ ok: false, reason: 'moved', movedTo: 'Pixel 7' });
  });

  it('counts transactions a restore would lose', async () => {
    const cloud = fakeCloud(memoryStore());
    const p = await phone('Pixel 7', cloud, true);
    const all = snapshot(p.db).transactions.length;
    expect(addedSince(p.db, '2000-01-01T00:00:00Z')).toBeGreaterThan(0);
    expect(addedSince(p.db, '2999-01-01T00:00:00Z')).toBe(0);
    expect(all).toBeGreaterThan(0);
  });
});

describe('attachments in backups', () => {
  it('upload once, encrypted, and come back on restore', async () => {
    const store = memoryStore();
    const cloud = fakeCloud(store);
    const old = await phone('Pixel 7', cloud, true);
    const oldFiles = new Map<string, Uint8Array>();
    const tx = snapshot(old.db).transactions[0].id as string;
    old.db.insert(attachments).values({ id: 'att-1', transactionId: tx, filePath: 'attachments/receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 5 }).run();
    oldFiles.set('attachments/receipt.jpg', new TextEncoder().encode('JPEG!'));
    const deps = { ...old, files: { read: (p: string) => oldFiles.get(p) ?? null, write: (p: string, d: Uint8Array) => void oldFiles.set(p, d) } };
    await turnOnBackup(deps, 'pw-12345678');
    await backupNow(deps);
    expect(await cloud.listAttachments()).toEqual(['att-1.bin']);
    // Encrypted: the file in Drive isn't the photo.
    const inDrive = await cloud.downloadAttachment('att-1.bin');
    expect(new TextDecoder().decode(inDrive!)).not.toContain('JPEG!');

    // Uploaded once: a second backup doesn't send it again.
    const upload = jest.spyOn(cloud, 'uploadAttachment');
    await backupNow(deps);
    expect(upload).not.toHaveBeenCalled();

    const fresh = await phone('Pixel 9', cloud);
    const newFiles = new Map<string, Uint8Array>();
    const freshDeps = { ...fresh, files: { read: (p: string) => newFiles.get(p) ?? null, write: (p: string, d: Uint8Array) => void newFiles.set(p, d) } };
    await lookInDrive(freshDeps);
    await restoreFromDrive(freshDeps, 'pw-12345678');
    expect(new TextDecoder().decode(newFiles.get('attachments/receipt.jpg')!)).toBe('JPEG!');

    // Deleted on the phone → gone from Drive with the next backup.
    fresh.db.delete(attachments).run();
    await backupNow(freshDeps);
    expect(await cloud.listAttachments()).toEqual([]);
  });
});
