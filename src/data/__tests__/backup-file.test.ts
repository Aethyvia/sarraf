import { eq } from 'drizzle-orm';

import { ensureBaseData } from '@/db/base-data';
import { buildSampleData, SAMPLE_TODAY } from '@/db/sample';
import { settings } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { newDataKey, newRecoveryKey, normalizeRecoveryKey, wrapKey, WrongSecretError } from '@/lib/backup-crypto';
import { createTestDb } from '@/test/db';
import { setup } from '@/test/factories';
import { BACKUP_FORMAT, BackupTooNewError, buildBackup, FILE_VERSION, NotABackupError, openBackup, readBackupHeader, restoreSnapshot, snapshot } from '../backup-file';
import { currencyPositions } from '../usable';

const KDF = { t: 1, m: 64, p: 1 };

async function sampleDb(): Promise<AppDb> {
  const db = await createTestDb();
  ensureBaseData(db);
  db.transaction((tx) => buildSampleData(tx));
  return db;
}

async function makeBackup(db: AppDb) {
  const dataKey = newDataKey();
  const recovery = newRecoveryKey();
  const keys = { password: await wrapKey(dataKey, 'the password that matters', KDF), recovery: await wrapKey(dataKey, normalizeRecoveryKey(recovery), KDF) };
  const file = buildBackup(db, { dataKey, keys, deviceId: 'pixel-7-id', deviceName: 'Pixel 7', createdAt: '2026-09-30T08:00:00Z' });
  return { file, recovery };
}

describe('backup file', () => {
  it('the header is readable without a password: phone, date, counts (no amounts)', async () => {
    const db = await sampleDb();
    const { file } = await makeBackup(db);
    const { header } = readBackupHeader(file);
    expect(header).toMatchObject({ format: BACKUP_FORMAT, deviceName: 'Pixel 7', deviceId: 'pixel-7-id', createdAt: '2026-09-30T08:00:00Z' });
    expect(header.counts.accounts).toBe(6);
    expect(header.counts.ledgers).toBe(2);
    expect(header.counts.transactions).toBeGreaterThan(20);
    expect(new TextDecoder().decode(file)).not.toContain('Payoneer');
  });

  it('restores everything onto another phone, replacing what was there', async () => {
    const from = await sampleDb();
    const { file, recovery } = await makeBackup(from);

    const t = await setup();
    t.account('Leftover', 'GBP');
    t.db.update(settings).set({ deviceId: 'new-phone', appLockEnabled: true, pinHash: 'x' }).where(eq(settings.id, 1)).run();

    const opened = await openBackup(file, recovery.toLowerCase());
    restoreSnapshot(t.db, opened.data, { deviceId: 'new-phone' });

    const a = snapshot(from);
    const b = snapshot(t.db);
    for (const name of Object.keys(a)) {
      if (name === 'settings') continue;
      expect([name, b[name]]).toEqual([name, a[name]]);
    }
    const s = t.db.select().from(settings).get()!;
    expect(s.deviceId).toBe('new-phone');
    expect(s.appLockEnabled).toBe(false);
    expect(s.pinHash).toBeNull();
    expect(currencyPositions(t.db, SAMPLE_TODAY)).toEqual(currencyPositions(from, SAMPLE_TODAY));
  });

  it('wrong password, tampered or foreign files change nothing', async () => {
    const from = await sampleDb();
    const { file } = await makeBackup(from);
    await expect(openBackup(file, 'nope')).rejects.toBeInstanceOf(WrongSecretError);

    const tampered = file.slice();
    tampered[tampered.length - 5] ^= 1;
    await expect(openBackup(tampered, 'the password that matters')).rejects.toBeInstanceOf(WrongSecretError);

    // Editing the readable header (e.g. the phone it names) breaks the file too.
    const text = new TextDecoder().decode(file);
    const edited = new TextEncoder().encode(text.replace('Pixel 7', 'Pixel 8'));
    await expect(openBackup(edited, 'the password that matters')).rejects.toBeInstanceOf(WrongSecretError);

    expect(() => readBackupHeader(new TextEncoder().encode('hello\nworld'))).toThrow(NotABackupError);
  });

  it('a backup from a newer Sarraf is refused with a message to update', async () => {
    const from = await sampleDb();
    const { file } = await makeBackup(from);
    const text = new TextDecoder().decode(file);
    const newer = new TextEncoder().encode(text.replace(`"format":${BACKUP_FORMAT}`, `"format":${BACKUP_FORMAT + 1}`));
    expect(() => readBackupHeader(newer)).toThrow(BackupTooNewError);
  });

  it('a damaged snapshot rolls back and leaves the phone as it was', async () => {
    const t = await setup();
    const keep = t.account('Keep me', 'USD');
    const from = await sampleDb();
    const data = snapshot(from);
    data.transactions = [{ ...data.transactions[0], accountId: 'missing-account' }];
    expect(() => restoreSnapshot(t.db, data, { deviceId: 'x' })).toThrow(/damaged/);
    expect(snapshot(t.db).accounts.map((a) => a.id)).toEqual([keep]);
  });
});

describe('a backup says whose it is (council, owner Nov 14)', () => {
  it('records the Sarraf account and the file version, and they can’t be edited', async () => {
    const db = await sampleDb();
    const dataKey = newDataKey();
    const keys = { password: await wrapKey(dataKey, 'the password that matters', KDF), recovery: await wrapKey(dataKey, normalizeRecoveryKey(newRecoveryKey()), KDF) };
    const file = buildBackup(db, { dataKey, keys, deviceId: 'd', deviceName: 'Pixel 7', createdAt: '2026-09-30T08:00:00Z', ownerId: 'user-a' });
    const { header } = readBackupHeader(file);
    expect(header).toMatchObject({ ownerId: 'user-a', fileVersion: FILE_VERSION });
    expect((await openBackup(file, 'the password that matters')).header.ownerId).toBe('user-a');
    // Swap the owner in the header: the file no longer opens.
    const text = new TextDecoder().decode(file.subarray(0, file.indexOf(10)));
    const forged = new TextEncoder().encode(text.replace('user-a', 'user-b') + '\n');
    const tampered = new Uint8Array(forged.length + file.length - file.indexOf(10) - 1);
    tampered.set(forged);
    tampered.set(file.subarray(file.indexOf(10) + 1), forged.length);
    await expect(openBackup(tampered, 'the password that matters')).rejects.toThrow();
  });
});
