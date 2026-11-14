import { getDeviceState } from '@/data/backup-flow';
import { activeFile, db, deleteFile, loadProfiles, peekFile, saveProfiles, switchToFile } from '@/db/client';
import { GUEST, fileForGuest, fileForSignIn, recordActive, withoutFile } from '@/db/profiles';
import { newId } from '@/lib/id';
import { deleteStoredFiles } from './attachments';
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
  const paths = peekFile(file, (h) => {
    try {
      return h.getAllSync<{ file_path: string }>('SELECT file_path FROM attachments').map((r) => r.file_path);
    } catch {
      return [];
    }
  });
  deleteStoredFiles(paths);
  await clearKeysOf(file);
  deleteFile(file);
  saveProfiles(withoutFile(loadProfiles(), file));
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
