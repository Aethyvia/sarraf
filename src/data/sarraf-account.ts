import { eq, sql } from 'drizzle-orm';

import { ensureBaseData } from '@/db/base-data';
import { deviceState } from '@/db/schema';
import type { AppDb } from '@/db/types';
import type { BackupDeps } from './backup-flow';
import { currentUser } from './backup-flow';

/**
 * Sign out (Settings board): the data stays on this phone; Sarraf asks to sign
 * in again before going on, and backups pause until then.
 */
export async function signOut(deps: BackupDeps, now: string): Promise<void> {
  const was = currentUser(deps.db)?.id ?? null;
  await deps.cloud.signOut();
  deps.db
    .update(deviceState)
    .set({ signedOutUserId: was, userId: null, userEmail: null, signInMethod: null, signedOutAt: now, plan: 'free', planRenewsAt: null, planCheckedAt: null })
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

/** Every local table emptied, then the base rows again (a fresh install). */
export function wipeLocalData(db: AppDb): void {
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
}

/**
 * Delete Sarraf account (Spec §5 — Decided): always the sign-in, the backup
 * record and everything on this phone; the Drive backup only when ticked.
 * Doesn't cancel a store subscription (the sheet says so).
 */
export async function deleteSarrafAccount(deps: BackupDeps, options: { deleteDriveBackup: boolean; deleteFiles: () => void }): Promise<void> {
  const user = currentUser(deps.db);
  if (options.deleteDriveBackup) await deps.cloud.deleteBackup();
  if (user) await deps.cloud.deleteAccount(user);
  await deps.keyStore.clear();
  options.deleteFiles();
  wipeLocalData(deps.db);
}
