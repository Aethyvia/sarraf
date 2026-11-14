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

describe('restore problems (owner, Nov 14)', () => {
  const { restoreProblem } = jest.requireActual('../backup-errors') as typeof import('../backup-errors');
  it('names the cause instead of "Something went wrong"', () => {
    expect(restoreProblem(new Error('No backup in this Drive'))).toMatch(/isn’t in this Google Drive/);
    expect(restoreProblem(new OfflineError())).toMatch(/offline/);
    expect(restoreProblem(new DriveRefusedError())).toMatch(/couldn’t open your Google Drive/);
    expect(restoreProblem(new Error('The backup is damaged (no settings).'))).toMatch(/damaged/);
    expect(restoreProblem(new Error('Boom'))).toBe('It stopped with: Boom.');
  });
});

describe('Delete backup picks only this account’s files (owner, Nov 14)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isThisAccountsFile } = require('@/services/cloud/real') as typeof import('@/services/cloud/real');
  const me = 'aaaaaaaa-1111-2222-3333-444444444444';
  const other = 'bbbbbbbb-1111-2222-3333-444444444444';
  const att = 'cccccccc-1111-2222-3333-444444444444.bin';
  const check = (f: string) => isThisAccountsFile(f, `sarraf-backup-${me}.bin`, `att-${me}-`);
  it('mine and the old shared names go; another account’s stay', () => {
    expect(check(`sarraf-backup-${me}.bin`)).toBe(true);
    expect(check(`att-${me}-${att}`)).toBe(true);
    expect(check('sarraf-backup.bin')).toBe(true);
    expect(check(`att-${att}`)).toBe(true);
    expect(check(`sarraf-backup-${other}.bin`)).toBe(false);
    expect(check(`att-${other}-${att}`)).toBe(false);
  });
});
