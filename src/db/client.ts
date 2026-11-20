import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { File } from 'expo-file-system';
import { defaultDatabaseDirectory, deleteDatabaseSync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';

import { exportToEncryptedSql, keyPragma } from '@/lib/local-crypto';
import { localKeys } from '@/services/local-keys';

import migrations from '../../drizzle/migrations';
import { ensureBaseData } from './base-data';
import { parseProfiles, withActive, type Profiles } from './profiles';
import * as schema from './schema';

/**
 * One database file per account on this phone, plus one for the guest (owner,
 * Nov 14); db/profiles keeps the list. `db` is the open one: every import reads
 * it at the moment of use, so switching files is seen everywhere.
 */
const PROFILES_KEY = 'sarraf.profiles';

export function loadProfiles(): Profiles {
  return parseProfiles(SecureStore.getItem(PROFILES_KEY));
}

export function saveProfiles(p: Profiles): void {
  SecureStore.setItem(PROFILES_KEY, JSON.stringify(p));
}

/**
 * Every database file is encrypted with SQLCipher using this phone's key (owner,
 * Nov 20). Builds without SQLCipher (e.g. an old dev build) keep files as they
 * are, so nothing breaks before the new build is installed.
 */
let cipher: boolean | null = null;
export function encryptionAvailable(): boolean {
  if (cipher === null) {
    const probe = openDatabaseSync(':memory:');
    try {
      cipher = !!probe.getFirstSync<{ cipher_version?: string }>('PRAGMA cipher_version')?.cipher_version;
    } catch {
      cipher = false;
    } finally {
      probe.closeSync();
    }
  }
  return cipher;
}

const SAFE_NAME = /^sarraf-[A-Za-z0-9-]+\.db$/;
const dbDirPath = () => defaultDatabaseDirectory.replace(/^file:\/\//, '');
const dbFile = (name: string) => new File(`file://${dbDirPath()}/${name}`);

/** True when the file opens without a key: saved before encryption. */
function isPlain(file: string): boolean {
  const probe = openDatabaseSync(file);
  try {
    probe.getFirstSync('SELECT count(*) AS n FROM sqlite_master');
    return true;
  } catch {
    return false;
  } finally {
    probe.closeSync();
  }
}

/**
 * Encrypts a file saved before encryption, in place: copies it into a new
 * encrypted file, then swaps the two. A crash part-way leaves the old file intact.
 */
function encryptInPlace(file: string, key: string): void {
  if (!SAFE_NAME.test(file) || !dbFile(file).exists || !isPlain(file)) return;
  const tmp = file.replace(/\.db$/, '.encrypting');
  try {
    deleteDatabaseSync(tmp);
  } catch {
    // No leftover from an earlier try.
  }
  const plain = openDatabaseSync(file);
  try {
    plain.execSync('PRAGMA wal_checkpoint(TRUNCATE);');
    plain.execSync(exportToEncryptedSql(`${dbDirPath()}/${tmp}`, key));
  } finally {
    plain.closeSync();
  }
  deleteDatabaseSync(file);
  dbFile(tmp).rename(file);
}

/**
 * If this phone's key can't open a file (the keystore was reset, e.g. after
 * some factory resets), the file is set aside — kept, never deleted — and an
 * empty one opens in its place, so the person can restore their Drive backup.
 */
function setAside(file: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbFile(file + suffix);
    if (f.exists) f.rename(`${file}${suffix}.unreadable-${Date.now()}`);
  }
}

function openHandle(file: string, options?: { enableChangeListener: boolean }): SQLiteDatabase {
  if (!encryptionAvailable()) return openDatabaseSync(file, options);
  const key = localKeys().db;
  encryptInPlace(file, key);
  let handle = openDatabaseSync(file, options);
  handle.execSync(keyPragma(key));
  try {
    handle.getFirstSync('SELECT count(*) AS n FROM sqlite_master');
  } catch {
    handle.closeSync();
    setAside(file);
    handle = openDatabaseSync(file, options);
    handle.execSync(keyPragma(key));
  }
  return handle;
}

function open(file: string) {
  /** enableChangeListener lets live queries re-run when rows change. */
  const handle = openHandle(file, { enableChangeListener: true });
  handle.execSync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return { handle, db: drizzle(handle, { schema }) };
}

let current = open(loadProfiles().active);

export let sqlite: SQLiteDatabase = current.handle;
export let db = current.db;
export type Db = typeof db;

/** The open file's name. */
export const activeFile = (): string => loadProfiles().active;

const listeners = new Set<() => void>();
let version = 0;
/** Bumps on every switch, so screens holding state from the old file can reset. */
export const profileVersion = () => version;
export function onProfileSwitch(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Opens another file (an account's saved data, the guest's, or a new empty one),
 * brings it up to date and makes it the open one. A touch write then wakes every
 * live screen, so they read the new file.
 */
export async function switchToFile(file: string): Promise<void> {
  if (file === loadProfiles().active) return;
  const next = open(file);
  await migrate(next.db, migrations);
  ensureBaseData(next.db);
  const old = current;
  current = next;
  sqlite = next.handle;
  db = next.db;
  saveProfiles(withActive(loadProfiles(), file));
  version += 1;
  for (const l of listeners) l();
  next.handle.execSync('UPDATE settings SET updated_at = updated_at WHERE id = 1');
  try {
    old.handle.closeSync();
  } catch {
    // Already closed.
  }
}

/** Deletes a file that isn't open (Remove saved data). */
export function deleteFile(file: string): void {
  if (file === loadProfiles().active) throw new Error('That data is open');
  try {
    deleteDatabaseSync(file);
  } catch {
    // Already gone.
  }
}

/** Opens a file that isn't the open one just to read from it (e.g. its attachment paths before removing it). */
export function peekFile<T>(file: string, read: (handle: SQLiteDatabase) => T): T {
  const handle = openHandle(file);
  try {
    return read(handle);
  } finally {
    handle.closeSync();
  }
}
