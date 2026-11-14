import { eq, sql } from 'drizzle-orm';

import { ensureBaseData } from '@/db/base-data';
import { compactDatabase } from '@/db/compact';
import { deviceState, settings } from '@/db/schema';
import type { AppDb } from '@/db/types';
import type { BackupDeps } from './backup-flow';
import { currentUser, detachPreviousBackup, rememberSignIn } from './backup-flow';

/**
 * Sign out (owner, Nov 14): a checkbox, ticked at first, removes this phone's
 * data too. The Drive backup stays, so signing in again restores it; the screen
 * backs up first when backup is on and warns when it's off. Unticked, the data
 * stays and Sarraf asks to sign in again before going on (backups pause).
 * A guest has no Sign out.
 */
export async function signOut(deps: BackupDeps, options: { removeData: boolean; deleteFiles: () => void; now: string }): Promise<void> {
  const was = currentUser(deps.db)?.id ?? null;
  await deps.cloud.signOut();
  if (options.removeData) {
    await deps.keyStore.clear();
    options.deleteFiles();
    wipeLocalData(deps.db);
    return;
  }
  deps.db
    .update(deviceState)
    .set({ signedOutUserId: was, userId: null, userEmail: null, signInMethod: null, signedOutAt: options.now, plan: 'free', planRenewsAt: null, planCheckedAt: null })
    .where(eq(deviceState.id, 1))
    .run();
}

export function isSignedOut(db: AppDb): boolean {
  return !!db.select({ s: deviceState.signedOutAt }).from(deviceState).where(eq(deviceState.id, 1)).get()?.s;
}

/** Signing back in on a phone that still has its data: no restore, no setup, just carry on. */
export function clearSignedOut(db: AppDb): void {
  db.update(deviceState).set({ signedOutAt: null, signedOutUserId: null }).where(eq(deviceState.id, 1)).run();
}

/**
 * Every local table emptied, then the base rows again. It's still the same
 * phone, so it keeps its device id: a backup it made stays "this phone's".
 */
export function wipeLocalData(db: AppDb): void {
  const keepDeviceId = db.select({ id: settings.deviceId }).from(settings).where(eq(settings.id, 1)).get()?.id;
  const tables = db
    .all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'`)
    .map((t) => t.name);
  db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    db.transaction((tx) => {
      for (const name of tables) tx.run(sql.raw(`delete from "${name}"`));
    });
  } finally {
    db.run(sql`PRAGMA foreign_keys = ON`);
  }
  ensureBaseData(db);
  if (keepDeviceId) db.update(settings).set({ deviceId: keepDeviceId }).where(eq(settings.id, 1)).run();
  // Deleted rows mustn't linger in the file's free pages (owner, Nov 14: no residue).
  compactDatabase(db);
}

export interface DeleteChoice {
  /** The sign-in, the backup record and the subscription row (Supabase). */
  account: boolean;
  /** Everything Sarraf keeps on this phone. */
  phone: boolean;
  /** The backup file and attachments in Google Drive. */
  drive: boolean;
}

/**
 * Delete (owner, Nov 12 — replaces "account and phone always go together",
 * Spec §5): each part is chosen on its own.
 * - Account only: this phone's data stays, signed out; its backup keys and
 *   Drive go (they belonged to that account). Signing in again offers Keep.
 * - Phone only: the data is erased; still signed in, so setup (or restore) follows.
 * - Drive only: the backup and its record go; backup turns off on this phone.
 * Doesn't cancel a store subscription (the sheet says so).
 */
export async function deleteChosen(deps: BackupDeps, choice: DeleteChoice, options: { deleteFiles: () => void; now: string }): Promise<void> {
  const user = currentUser(deps.db);
  if (choice.drive) {
    await deps.cloud.deleteBackup();
    if (user && !choice.account) await deps.cloud.deleteRecord(user);
  }
  if (choice.account && user) await deps.cloud.deleteAccount(user);
  if (choice.phone) {
    await deps.keyStore.clear();
    options.deleteFiles();
    wipeLocalData(deps.db);
    // Keeping the account: stay signed in on the emptied phone.
    if (!choice.account && user) rememberSignIn(deps.db, user);
    return;
  }
  if (choice.account || choice.drive) await detachPreviousBackup(deps);
  if (choice.account) {
    deps.db
      .update(deviceState)
      .set({ signedOutUserId: user?.id ?? null, userId: null, userEmail: null, signInMethod: null, signedOutAt: options.now, plan: 'free', planRenewsAt: null, planCheckedAt: null })
      .where(eq(deviceState.id, 1))
      .run();
  }
}
