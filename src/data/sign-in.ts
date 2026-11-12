import type { BackupRecord } from '@/services/cloud/types';

/**
 * What happens right after sign-in (council, Nov 12; replaces "Have you used
 * Sarraf before?"). The app checks everything it can; a question appears only
 * when there's a real choice between this phone's data and a backup, or the
 * data on this phone belongs to another sign-in.
 *
 * - `home`: this phone's data, signing back in to the same account, and no
 *   other phone owns the backup. Carry on.
 * - `hasData`: this phone has data and something conflicts (no account or a
 *   different one before, or a backup made by another phone). Keep / Restore /
 *   Start over.
 * - `found`: an empty phone and a backup on record. Restore / Start fresh.
 * - `setup`: an empty phone and no backup on record. New-user setup; the Drive
 *   itself is checked when backup is turned on (the record isn't the truth).
 */
export type AfterSignIn = 'home' | 'hasData' | 'found' | 'setup';

export interface SignInFacts {
  /** This phone has money data (first run finished). */
  hasData: boolean;
  /** Who this phone's data belonged to before this sign-in (null: nobody). */
  prevUserId: string | null;
  userId: string;
  record: Pick<BackupRecord, 'deviceId'> | null;
  thisDeviceId: string;
}

export function decideAfterSignIn(f: SignInFacts): AfterSignIn {
  if (!f.hasData) return f.record ? 'found' : 'setup';
  const sameAccount = f.prevUserId === f.userId;
  const backupIsOurs = !f.record || f.record.deviceId === f.thisDeviceId;
  return sameAccount && backupIsOurs ? 'home' : 'hasData';
}

/** Keeping this phone's data under a different account than it had: the old account's backup doesn't come along. */
export function isAccountSwitch(f: Pick<SignInFacts, 'prevUserId' | 'userId'>): boolean {
  return !!f.prevUserId && f.prevUserId !== f.userId;
}
