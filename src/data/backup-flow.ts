import { and, eq, gt, isNull } from 'drizzle-orm';

import { deviceState, settings, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { b64, DEFAULT_KDF, newDataKey, newRecoveryKey, normalizeRecoveryKey, RECOVERY_KDF, unb64, wrapKey } from '@/lib/backup-crypto';
import type { BackupRecord, Cloud, CloudUser } from '@/services/cloud/types';
import { BACKUP_FORMAT, backupCounts, buildBackup, openBackup, readBackupHeader, restoreSnapshot, type BackupHeader } from './backup-file';

/** The data key and its two wrapped copies, kept on this phone (Android keystore). */
export interface StoredKeys {
  dataKey: string;
  keys: BackupHeader['keys'];
  /** When the backup password was last set (Backup screen: "Set Sep 2, 2026"). */
  passwordSetAt?: string;
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
 * password and by a new recovery key, kept on this phone. The recovery key is
 * returned at once so it can be shown while the (slow) password wrap finishes;
 * await `finished` before backing up.
 */
export function startBackupSetup(deps: BackupDeps, password: string): { recoveryKey: string; finished: Promise<void> } {
  const dataKey = newDataKey();
  const recoveryKey = newRecoveryKey();
  const finished = (async () => {
    const byRecovery = await wrapKey(dataKey, normalizeRecoveryKey(recoveryKey), RECOVERY_KDF);
    const byPassword = await wrapKey(dataKey, password, DEFAULT_KDF);
    await deps.keyStore.set({ dataKey: b64(dataKey), keys: { password: byPassword, recovery: byRecovery }, passwordSetAt: deps.now?.() ?? new Date().toISOString() });
    setDeviceState(deps.db, { backupEnabled: true, backupMovedAt: null, backupMovedTo: null });
  })();
  return { recoveryKey, finished };
}

export async function turnOnBackup(deps: BackupDeps, password: string): Promise<{ recoveryKey: string }> {
  const { recoveryKey, finished } = startBackupSetup(deps, password);
  await finished;
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
  const file = await deps.cloud.downloadBackup((done, total) => onProgress?.('download', done, total));
  return restoreFromFile(deps, file, secret, onProgress);
}

/** Restore from an already-downloaded backup (so a wrong password doesn't download it again). */
export async function restoreFromFile(
  deps: BackupDeps,
  file: Uint8Array,
  secret: string,
  onProgress?: (step: 'download' | 'open' | 'replace', done: number, total: number) => void,
): Promise<BackupHeader> {
  onProgress?.('open', 0, 1);
  const opened = await openBackup(file, secret);
  return applyRestore(deps, opened, file.length, onProgress);
}

/**
 * The replace step of a restore, once the backup is open: replaces everything
 * on this phone, keeps the keys, and claims the backup for this phone.
 */
export async function applyRestore(
  deps: BackupDeps,
  opened: Awaited<ReturnType<typeof openBackup>>,
  sizeBytes: number,
  onProgress?: (step: 'download' | 'open' | 'replace', done: number, total: number) => void,
): Promise<BackupHeader> {
  const { db, cloud } = deps;
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
      sizeBytes,
      counts: opened.header.counts,
      format: opened.header.format,
    });
  }
  onProgress?.('replace', 1, 1);
  return opened.header;
}

/**
 * Backup screen → Backup password → Change. The data key stays the same; only
 * its password-wrapped copy changes, so the next backup opens with the new
 * password (and the recovery key keeps working).
 */
export async function changeBackupPassword(deps: BackupDeps, password: string): Promise<void> {
  const stored = await deps.keyStore.get();
  if (!stored) throw new Error('Backup isn’t on');
  const byPassword = await wrapKey(unb64(stored.dataKey), password, DEFAULT_KDF);
  await deps.keyStore.set({ ...stored, keys: { ...stored.keys, password: byPassword }, passwordSetAt: deps.now?.() ?? new Date().toISOString() });
}

/** Backup screen → Recovery key → Renew: a new key; the old one stops working with the next backup. */
export async function renewRecoveryKey(deps: BackupDeps): Promise<string> {
  const stored = await deps.keyStore.get();
  if (!stored) throw new Error('Backup isn’t on');
  const recoveryKey = newRecoveryKey();
  const byRecovery = await wrapKey(unb64(stored.dataKey), normalizeRecoveryKey(recoveryKey), RECOVERY_KDF);
  await deps.keyStore.set({ ...stored, keys: { ...stored.keys, recovery: byRecovery } });
  return recoveryKey;
}

/** "Make this the backup phone" on a phone whose backups moved: its next backup takes over. */
export async function makeThisTheBackupPhone(deps: BackupDeps): Promise<BackupResult> {
  setDeviceState(deps.db, { backupMovedAt: null, backupMovedTo: null, lastBackupAt: null });
  return backupNow(deps);
}

/** Backup screen → Turn backup off (keeps the backup in Drive; keys stay so turning on again is quick). */
export function setAutomaticBackup(db: AppDb, on: boolean): void {
  db.update(settings).set({ backupFrequency: on ? 'daily' : 'manual' }).where(eq(settings.id, 1)).run();
}

/** Days between automatic backups for each frequency; manual never runs on its own. */
const EVERY_DAYS = { daily: 1, weekly: 7 } as const;

/**
 * Whether an automatic backup should run now (on app open): backup is on,
 * not moved, the frequency isn't Manual, enough time has passed, and the
 * network fits "Wi-Fi only".
 */
export function automaticBackupDue(db: AppDb, now: Date, network: { online: boolean; wifi: boolean }): boolean {
  const state = getDeviceState(db);
  const set = db.select().from(settings).where(eq(settings.id, 1)).get()!;
  if (!state.backupEnabled || state.backupMovedAt || set.backupFrequency === 'manual') return false;
  if (!network.online || (set.backupWifiOnly && !network.wifi)) return false;
  if (!state.lastBackupAt) return true;
  const days = EVERY_DAYS[set.backupFrequency];
  return now.getTime() - new Date(state.lastBackupAt).getTime() >= days * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;
}

/** Records a failed automatic backup; "Backup problems" notifies after 3 days of this. */
export function noteBackupFailed(db: AppDb, now: string): void {
  const state = getDeviceState(db);
  if (!state.backupFailingSince) setDeviceState(db, { backupFailingSince: now });
}

/** Restore confirm sheet: transactions on this phone added after the backup was made (they'd be lost). */
export function addedSince(db: AppDb, iso: string): number {
  return db.select({ id: transactions.id }).from(transactions).where(and(isNull(transactions.deletedAt), gt(transactions.createdAt, iso))).all().length;
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
