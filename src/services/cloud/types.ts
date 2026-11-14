import type { BackupCounts } from '@/data/backup-file';

export type SignInMethod = 'google' | 'github' | 'email' | 'dev';

export interface CloudUser {
  id: string;
  email: string;
  method: SignInMethod;
}

/** Supabase's backup_records row (Schema — Decided): where the backup is, counts only, no money data. */
export interface BackupRecord {
  driveEmail: string;
  lastBackupAt: string;
  deviceId: string;
  deviceName: string;
  sizeBytes: number;
  counts: BackupCounts;
  format: number;
}

/**
 * Everything Sarraf does online: sign-in and the backup record (Supabase) and
 * the backup file (the user's own Google Drive, app-data folder). Money data
 * only ever goes to Drive, encrypted.
 */
export interface Cloud {
  /** False until the real services are set up; the UI says sign-in isn't available yet. */
  readonly ready: boolean;
  signIn(method: 'google' | 'github'): Promise<CloudUser>;
  sendEmailCode(email: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<CloudUser>;
  signOut(): Promise<void>;
  getRecord(user: CloudUser): Promise<BackupRecord | null>;
  putRecord(user: CloudUser, record: BackupRecord): Promise<void>;
  /** Deleting only the Drive backup: its record goes too, so no phone is offered a backup that's gone. */
  deleteRecord(user: CloudUser): Promise<void>;
  /** Asks for Drive access (app-data folder only). `another` picks a different Google account. */
  connectDrive(options?: { another?: boolean }): Promise<{ email: string }>;
  findBackup(): Promise<{ modifiedAt: string; sizeBytes: number } | null>;
  downloadBackup(onProgress?: (done: number, total: number) => void): Promise<Uint8Array>;
  uploadBackup(file: Uint8Array): Promise<void>;
  /** Attachments are separate encrypted files in the same app-data folder, uploaded once (Spec, Ideas added Nov 7). */
  listAttachments(): Promise<string[]>;
  uploadAttachment(name: string, file: Uint8Array): Promise<void>;
  downloadAttachment(name: string): Promise<Uint8Array | null>;
  deleteAttachment(name: string): Promise<void>;
  /** The Sarraf Plus subscription on record (Supabase), or null for Free. */
  getSubscription(user: CloudUser): Promise<{ plan: 'plus'; renewsAt: string | null; lifetime?: boolean } | null>;
  /** "Have a code?" (owner, Nov 14): a supporter code gives lifetime Plus. A code works once. */
  redeemCode(user: CloudUser, code: string): Promise<'ok' | 'used' | 'unknown'>;
  /** Until Play Billing (owner, Nov 12): Subscribe records Plus for this user directly. */
  testSubscribe(user: CloudUser, kind: 'monthly' | 'yearly'): Promise<void>;
  /** Delete Sarraf account: the backup file and attachments in Drive. */
  deleteBackup(): Promise<void>;
  /** Delete Sarraf account: the sign-in, backup record and subscription row. */
  deleteAccount(user: CloudUser): Promise<void>;
}

/** No internet: "Signing in needs internet, just this once." */
export class OfflineError extends Error {
  constructor() {
    super('You’re offline');
    this.name = 'OfflineError';
  }
}

/** Google Drive answered with a problem we can name (owner, Nov 14: say what went wrong). */
export class DriveError extends Error {
  constructor(
    readonly kind: 'full' | 'busy' | 'unavailable' | 'other',
    readonly status: number,
    detail: string,
  ) {
    super(detail);
    this.name = 'DriveError';
  }
}

/** Google said no to Drive access. */
export class DriveRefusedError extends Error {
  constructor() {
    super('Sarraf can’t see your Drive');
    this.name = 'DriveRefusedError';
  }
}

/** The person closed the sign-in or account picker. */
export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

/** A wrong or expired email code. */
export class BadCodeError extends Error {
  constructor() {
    super('That code didn’t work');
    this.name = 'BadCodeError';
  }
}
