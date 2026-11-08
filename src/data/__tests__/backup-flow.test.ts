import { eq } from 'drizzle-orm';

import { ensureBaseData } from '@/db/base-data';
import { buildSampleData } from '@/db/sample';
import { settings } from '@/db/schema';
import { WrongSecretError } from '@/lib/backup-crypto';
import { fakeCloud, memoryStore } from '@/services/cloud/fake';
import { createTestDb } from '@/test/db';
import { snapshot } from '../backup-file';
import { backupNow, getDeviceState, lookInDrive, memoryKeyStore, rememberSignIn, restoreFromDrive, turnOnBackup } from '../backup-flow';

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
