import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { deleteDatabaseSync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';

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

function open(file: string) {
  /** enableChangeListener lets live queries re-run when rows change. */
  const handle = openDatabaseSync(file, { enableChangeListener: true });
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
  const handle = openDatabaseSync(file);
  try {
    return read(handle);
  } finally {
    handle.closeSync();
  }
}
