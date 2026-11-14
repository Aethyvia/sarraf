import type { BackupResult } from '@/data/backup-flow';
import { strings } from '@/i18n/strings';
import { DriveError, DriveRefusedError, OfflineError } from '@/services/cloud/types';

/**
 * What went wrong with a backup, in plain words (owner, Nov 14: "shouldn't it
 * be specific?"). Takes a failed backup result or a thrown error. Anything we
 * can't name still shows the error's own text, so it can be reported.
 */
export function backupProblem(problem: BackupResult | unknown): string {
  const s = strings.backup.problems;
  if (problem && typeof problem === 'object' && 'ok' in problem && (problem as BackupResult).ok === false) {
    const r = problem as Exclude<BackupResult, { ok: true }>;
    switch (r.reason) {
      case 'off':
        return s.off;
      case 'moved':
        return s.moved(r.movedTo ?? '');
      case 'signed_out':
        return s.signedOut;
      case 'no_keys':
        return s.noKeys;
      case 'existing':
        return s.existing;
    }
  }
  if (problem instanceof OfflineError) return s.offline;
  if (problem instanceof DriveRefusedError) return s.driveRefused;
  if (problem instanceof DriveError) {
    if (problem.kind === 'full') return s.driveFull;
    if (problem.kind === 'busy') return s.driveBusy;
    if (problem.kind === 'unavailable') return s.driveDown;
    return s.other(problem.message);
  }
  const message = problem instanceof Error ? problem.message : '';
  if (/not signed in|jwt|session/i.test(message)) return s.signInAgain;
  if (/wrong password|decrypt|authentication tag/i.test(message)) return s.keysChanged;
  return s.other(message);
}
