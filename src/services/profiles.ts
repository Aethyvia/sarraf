import { Directory, File, Paths } from 'expo-file-system';
import { defaultDatabaseDirectory } from 'expo-sqlite';

import { getDeviceState } from '@/data/backup-flow';
import { activeFile, db, deleteFile, loadProfiles, peekFile, saveProfiles, switchToFile } from '@/db/client';
import { GUEST, MAIN_FILE, fileForGuest, fileForSignIn, recordActive, withoutFile } from '@/db/profiles';
import { attachments } from '@/db/schema';
import { newId } from '@/lib/id';
import { clearTempFiles, deleteStoredFiles } from './attachments';
import { clearKeysOf } from './cloud';

/**
 * Data saved per account on this phone (owner, Nov 14). These open, record and
 * remove the files; db/profiles decides which file is whose.
 */
const newFile = () => `sarraf-${newId()}.db`;

/** Notes who the open data belongs to (on app open, after sign-in, sign-out or a wipe). */
export function recordOpenProfile(now = new Date().toISOString()): void {
  const s = getDeviceState(db);
  const owner = s.userId ?? s.signedOutUserId ?? GUEST;
  saveProfiles(recordActive(loadProfiles(), owner, s.userEmail ?? null, now));
}

/** Before a sign-in goes on: that account's own saved data, the guest's (to keep or replace), or a new empty file. */
export async function openForSignIn(userId: string): Promise<void> {
  recordOpenProfile();
  const pick = fileForSignIn(loadProfiles(), userId);
  await switchToFile(pick.isNew ? newFile() : pick.file);
}

/** Continue as guest: the guest's saved data, or a new empty file. */
export async function openGuest(): Promise<void> {
  recordOpenProfile();
  const pick = fileForGuest(loadProfiles());
  await switchToFile(pick.isNew ? newFile() : pick.file);
  recordOpenProfile();
}

/** Removes data saved on this phone that isn't open: its file, attachments and backup keys. */
export async function removeSaved(file: string): Promise<void> {
  const paths = attachmentPathsOf(file);
  deleteStoredFiles(paths);
  await clearKeysOf(file);
  deleteFile(file);
  deleteDbLeftovers(file);
  saveProfiles(withoutFile(loadProfiles(), file));
}

/** expo-sqlite gives a plain path; expo-file-system wants a file:// URI (a plain path throws on use). */
const dbDirUri = () => (defaultDatabaseDirectory.startsWith('file://') ? defaultDatabaseDirectory : `file://${defaultDatabaseDirectory}`);
const dbDir = () => new Directory(dbDirUri());
const dbExists = (file: string) => {
  try {
    return new File(dbDir(), file).exists;
  } catch {
    // Can't tell: treat it as there, so saved data is never forgotten or swept by mistake.
    return true;
  }
};

/** The file and its write-ahead log and journal: nothing of it stays behind. */
function deleteDbLeftovers(file: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      const f = new File(dbDir(), file + suffix);
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  }
}

/** A saved file's attachment paths, read without opening it for use (and never creating it). */
function attachmentPathsOf(file: string): string[] {
  if (!dbExists(file)) return [];
  return peekFile(file, (h) => {
    try {
      return h.getAllSync<{ file_path: string }>('SELECT file_path FROM attachments').map((r) => r.file_path);
    } catch {
      return [];
    }
  });
}

/**
 * After the open data was emptied with no account left on it (sign out with
 * "Remove my data", or delete account + phone data): if the guest has data
 * saved here, that opens and the empty file goes; otherwise this one becomes
 * the guest's.
 */
export async function afterEmptied(): Promise<void> {
  recordOpenProfile();
  const p = loadProfiles();
  const guest = p.list.find((e) => e.owner === GUEST && e.file !== p.active);
  if (!guest) return;
  const emptied = activeFile();
  await switchToFile(guest.file);
  await removeSaved(emptied);
}

/**
 * On app open (owner, Nov 14: no residue): forgets saved entries whose file is
 * gone, deletes stray Sarraf database files nobody lists, and deletes attachment
 * files that no saved data points to (left by an abandoned draft or a failed delete).
 */
export async function sweepResidue(): Promise<void> {
  clearTempFiles();
  let p = loadProfiles();
  for (const e of p.list) if (e.file !== p.active && !dbExists(e.file)) p = withoutFile(p, e.file);
  saveProfiles(p);
  const listed = new Set([p.active, MAIN_FILE, ...p.list.map((e) => e.file)]);
  try {
    for (const item of dbDir().list()) {
      if (!(item instanceof File)) continue;
      const m = /^(sarraf-[A-Za-z0-9-]+\.db)(-wal|-shm|-journal)?$/.exec(item.name);
      if (m && !listed.has(m[1])) {
        if (!m[2]) await clearKeysOf(m[1]);
        item.delete();
      }
    }
  } catch {
    // No database folder yet.
  }
  const wanted = new Set(db.select({ path: attachments.filePath }).from(attachments).all().map((r) => r.path));
  for (const e of p.list) if (e.file !== p.active) for (const path of attachmentPathsOf(e.file)) wanted.add(path);
  try {
    const dir = new Directory(Paths.document, 'attachments');
    if (!dir.exists) return;
    for (const item of dir.list()) {
      if (item instanceof File && !wanted.has(`attachments/${item.name}`)) item.delete();
    }
  } catch {
    // Nothing to sweep.
  }
}
