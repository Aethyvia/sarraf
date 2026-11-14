import { backupProblem } from '../backup-errors';
import { DriveError, DriveRefusedError, OfflineError } from '@/services/cloud/types';

describe('backup problems say what went wrong (owner, Nov 14)', () => {
  it('names each known problem', () => {
    expect(backupProblem(new OfflineError())).toMatch(/offline/);
    expect(backupProblem(new DriveRefusedError())).toMatch(/can’t reach your Google Drive/);
    expect(backupProblem(new DriveError('full', 403, 'Google Drive 403 storageQuotaExceeded'))).toMatch(/Google Drive is full/);
    expect(backupProblem(new DriveError('busy', 429, 'x'))).toMatch(/busy/);
    expect(backupProblem(new DriveError('unavailable', 503, 'x'))).toMatch(/isn’t responding/);
    expect(backupProblem({ ok: false, reason: 'signed_out' })).toMatch(/not signed in/);
    expect(backupProblem({ ok: false, reason: 'no_keys' })).toMatch(/backup keys/);
    expect(backupProblem({ ok: false, reason: 'moved', movedTo: 'Pixel 7' })).toMatch(/Pixel 7/);
    expect(backupProblem(new Error('Not signed in'))).toMatch(/sign-in has expired/);
  });
  it('anything else still shows its own text, so it can be reported', () => {
    expect(backupProblem(new DriveError('other', 400, 'Google Drive 400 badRequest: Invalid query'))).toBe('Couldn’t back up: Google Drive 400 badRequest: Invalid query');
    expect(backupProblem(new Error('Disk I/O error'))).toBe('Couldn’t back up: Disk I/O error');
    expect(backupProblem(undefined)).toBe('Couldn’t back up. Try again.');
  });
});
