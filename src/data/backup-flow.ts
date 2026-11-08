import { eq } from 'drizzle-orm';

import { deviceState, settings } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { b64, DEFAULT_KDF, newDataKey, newRecoveryKey, normalizeRecoveryKey, RECOVERY_KDF, unb64, wrapKey } from '@/lib/backup-crypto';
import type { BackupRecord, Cloud, CloudUser } from '@/services/cloud/types';
import { BACKUP_FORMAT, backupCounts, buildBackup, openBackup, readBackupHeader, restoreSnapshot, type BackupHeader } from './backup-file';

/** The data key and its two wrapped copies, kept on this phone (Android keystore). */
export interface StoredKeys {
  dataKey: string;
  keys: BackupHeader['keys'];
}

export interface KeyStore {
  get(): Promise<StoredKeys | null>;
  set(keys: StoredKeys): Promise<void>;
  clear(): Promise<void>;
}

export interface BackupDeps {
  db: AppDb;
  cloud: Cloud;
  keyStore: KeyStore;
  deviceName: string;
  now?: () => string;
}

export type DeviceState = typeof deviceState.$inferSelect;

export function getDeviceState(db: AppDb): DeviceState {
  return db.select().from(deviceState).where(eq(deviceState.id, 1)).get()!;
}

function setDeviceState(db: AppDb, values: Partial<DeviceState>): void {
  db.update(deviceState).set(values).where(eq(deviceState.id, 1)).run();
}

function deviceId(db: AppDb): string {
  return db.select({ id: settings.deviceId }).from(settings).where(eq(settings.id, 1)).get()!.id;
}

export function currentUser(db: AppDb): CloudUser | null {
  const s = getDeviceState(db);
  return s.userId && s.userEmail && s.signInMethod ? { id: s.userId, email: s.userEmail, method: s.signInMethod } : null;
}

export function rememberSignIn(db: AppDb, user: CloudUser): void {
  setDeviceState(db, { userId: user.id, userEmail: user.email, signInMethod: user.method });
}

/** What sign-in found: the record (fast path, like WhatsApp), or nothing yet. */
export async function backupOnRecord(deps: BackupDeps, user: CloudUser): Promise<BackupRecord | null> {
  return deps.cloud.getRecord(user);
}

/** "Look in Google Drive": the backup's readable header, or null when this Drive has none. */
export async function lookInDrive(deps: BackupDeps, options?: { another?: boolean }): Promise<{ driveEmail: string; header: BackupHeader | null }> {
  const { email } = await deps.cloud.connectDrive(options);
  setDeviceState(deps.db, { driveEmail: email });
  const found = await deps.cloud.findBackup();
  if (!found) return { driveEmail: email, header: null };
  const file = await deps.cloud.downloadBackup();
  return { driveEmail: email, header: readBackupHeader(file).header };
}

/**
 * Turns backup on (setup step 3 or Settings): a new data key wrapped by the
 * password and by a new recovery key, kept on this phone. Returns the recovery
 * key to show once. Call backupNow() afterwards.
 */
export async function turnOnBackup(deps: BackupDeps, password: string): Promise<{ recoveryKey: string }> {
  const dataKey = newDataKey();
  const recoveryKey = newRecoveryKey();
  const [byRecovery, byPassword] = await Promise.all([wrapKey(dataKey, normalizeRecoveryKey(recoveryKey), RECOVERY_KDF), wrapKey(dataKey, password, DEFAULT_KDF)]);
  await deps.keyStore.set({ dataKey: b64(dataKey), keys: { password: byPassword, recovery: byRecovery } });
  setDeviceState(deps.db, { backupEnabled: true, backupMovedAt: null, backupMovedTo: null });
  return { recoveryKey };
}

export type BackupResult = { ok: true; at: string } | { ok: false; reason: 'off' | 'moved' | 'no_keys' | 'signed_out'; movedTo?: string };

/**
 * Makes a backup now. A phone that has backed up before stops when the record
 * names another phone (someone restored there; Decided Nov 7). A phone's
 * first backup takes over, which is how Start fresh replaces an old backup.
 */
export async function backupNow(deps: BackupDeps): Promise<BackupResult> {
  const { db, cloud } = deps;
  const state = getDeviceState(db);
  if (!state.backupEnabled) return { ok: false, reason: 'off' };
  if (state.backupMovedAt) return { ok: false, reason: 'moved', movedTo: state.backupMovedTo ?? undefined };
  const user = currentUser(db);
  if (!user) return { ok: false, reason: 'signed_out' };
  const stored = await deps.keyStore.get();
  if (!stored) return { ok: false, reason: 'no_keys' };
  const me = deviceId(db);
  const now = deps.now?.() ?? new Date().toISOString();

  const record = await cloud.getRecord(user);
  if (record && record.deviceId !== me && state.lastBackupAt) {
    setDeviceState(db, { backupMovedAt: now, backupMovedTo: record.deviceName });
    return { ok: false, reason: 'moved', movedTo: record.deviceName };
  }
  if (!state.driveEmail) setDeviceState(db, { driveEmail: (await cloud.connectDrive()).email });
  const file = buildBackup(db, { dataKey: unb64(stored.dataKey), keys: stored.keys, deviceId: me, deviceName: deps.deviceName, createdAt: now });
  await cloud.uploadBackup(file);
  await cloud.putRecord(user, {
    driveEmail: getDeviceState(db).driveEmail ?? '',
    lastBackupAt: now,
    deviceId: me,
    deviceName: deps.deviceName,
    sizeBytes: file.length,
    counts: backupCounts(db),
    format: BACKUP_FORMAT,
  });
  setDeviceState(db, { lastBackupAt: now, backupFailingSince: null });
  return { ok: true, at: now };
}

/**
 * Restore (replace-only): download, open with the password or recovery key,
 * replace everything on this phone, then claim the backup for this phone so
 * the old one stops. Throws WrongSecretError for a wrong password and leaves
 * the phone unchanged on any failure.
 */
export async function restoreFromDrive(
  deps: BackupDeps,
  secret: string,
  onProgress?: (step: 'download' | 'open' | 'replace', done: number, total: number) => void,
): Promise<BackupHeader> {
  const { db, cloud } = deps;
  const file = await cloud.downloadBackup((done, total) => onProgress?.('download', done, total));
  onProgress?.('open', 0, 1);
  const opened = await openBackup(file, secret);
  onProgress?.('replace', 0, 1);
  const me = deviceId(db);
  restoreSnapshot(db, opened.data, { deviceId: me });
  await deps.keyStore.set({ dataKey: b64(opened.dataKey), keys: opened.header.keys });
  const now = deps.now?.() ?? new Date().toISOString();
  setDeviceState(db, { backupEnabled: true, lastBackupAt: now, backupMovedAt: null, backupMovedTo: null, backupFailingSince: null });
  const user = currentUser(db);
  if (user) {
    await cloud.putRecord(user, {
      driveEmail: getDeviceState(db).driveEmail ?? '',
      lastBackupAt: opened.header.createdAt,
      deviceId: me,
      deviceName: deps.deviceName,
      sizeBytes: file.length,
      counts: opened.header.counts,
      format: opened.header.format,
    });
  }
  onProgress?.('replace', 1, 1);
  return opened.header;
}

export function memoryKeyStore(): KeyStore {
  let k: StoredKeys | null = null;
  return {
    get: async () => k,
    set: async (v) => {
      k = v;
    },
    clear: async () => {
      k = null;
    },
  };
}
