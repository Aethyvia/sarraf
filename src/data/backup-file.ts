import { getTableColumns, getTableName, isNull, sql, count } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import journal from '../../drizzle/meta/_journal.json';
import * as schema from '@/db/schema';
import { accounts, ledgers, settings, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { isRecoveryKeyShape, normalizeRecoveryKey, open, seal, unwrapKey, WrongSecretError, type WrappedKey } from '@/lib/backup-crypto';

/**
 * The backup file (Spec §3, Ideas added Nov 7): a readable header (which phone
 * made it, when, counts only — no amounts) and the whole database, encrypted
 * with the data key. Restore is replace-only.
 */

/** Grows with every database migration; older files are read, newer ones refused. */
export const BACKUP_FORMAT = journal.entries.length;
const MAGIC = 'SARRAF-BACKUP';

/** Every table, parents before children. */
export const TABLES: SQLiteTable[] = [
  schema.settings,
  schema.currencyOrder,
  schema.ledgers,
  schema.accounts,
  schema.categories,
  schema.people,
  schema.recurringItems,
  schema.transactions,
  schema.transactionCharges,
  schema.splitShares,
  schema.personEntries,
  schema.budgets,
  schema.savingsGoals,
  schema.goalAllocations,
  schema.attachments,
  schema.marketRates,
  schema.importPresets,
  schema.taxExports,
];

export interface BackupCounts {
  transactions: number;
  accounts: number;
  ledgers: number;
}

export interface BackupHeader {
  magic: typeof MAGIC;
  format: number;
  createdAt: string;
  deviceId: string;
  deviceName: string;
  counts: BackupCounts;
  keys: { password: WrappedKey; recovery: WrappedKey };
  nonce: string;
}

export class BackupTooNewError extends Error {
  constructor() {
    super('This backup was made by a newer Sarraf. Update the app to restore it.');
    this.name = 'BackupTooNewError';
  }
}

export class NotABackupError extends Error {
  constructor() {
    super('This file isn’t a Sarraf backup.');
    this.name = 'NotABackupError';
  }
}

export type Snapshot = Record<string, Record<string, unknown>[]>;

export function backupCounts(db: AppDb): BackupCounts {
  const n = (q: { n: number } | undefined) => q?.n ?? 0;
  return {
    transactions: n(db.select({ n: count() }).from(transactions).where(isNull(transactions.deletedAt)).get()),
    accounts: n(db.select({ n: count() }).from(accounts).get()),
    ledgers: n(db.select({ n: count() }).from(ledgers).get()),
  };
}

export function snapshot(db: AppDb): Snapshot {
  const out: Snapshot = {};
  for (const t of TABLES) out[getTableName(t)] = db.select().from(t).all() as Record<string, unknown>[];
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Builds an encrypted backup of the whole database. */
export function buildBackup(
  db: AppDb,
  input: { dataKey: Uint8Array; keys: BackupHeader['keys']; deviceId: string; deviceName: string; createdAt: string },
): Uint8Array {
  const body = encoder.encode(JSON.stringify(snapshot(db)));
  const base = {
    magic: MAGIC,
    format: BACKUP_FORMAT,
    createdAt: input.createdAt,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    counts: backupCounts(db),
    keys: input.keys,
  };
  // The nonce is chosen by seal(); the header minus the nonce is what's bound in.
  const aad = encoder.encode(JSON.stringify(base));
  const sealed = seal(input.dataKey, body, aad);
  const head = encoder.encode(JSON.stringify({ ...base, nonce: sealed.nonce }) + '\n');
  const file = new Uint8Array(head.length + sealed.data.length);
  file.set(head);
  file.set(sealed.data, head.length);
  return file;
}

/** The header, readable without any password: shown on "We found your backup". */
export function readBackupHeader(file: Uint8Array): { header: BackupHeader; bodyStart: number } {
  const nl = file.indexOf(10);
  if (nl < 0) throw new NotABackupError();
  let header: BackupHeader;
  try {
    header = JSON.parse(decoder.decode(file.subarray(0, nl)));
  } catch {
    throw new NotABackupError();
  }
  if (header?.magic !== MAGIC) throw new NotABackupError();
  if (header.format > BACKUP_FORMAT) throw new BackupTooNewError();
  return { header, bodyStart: nl + 1 };
}

/** Opens a backup with the backup password or the recovery key (either works). */
export async function openBackup(file: Uint8Array, secret: string): Promise<{ header: BackupHeader; dataKey: Uint8Array; data: Snapshot }> {
  const { header, bodyStart } = readBackupHeader(file);
  const tries: [WrappedKey, string][] = isRecoveryKeyShape(secret)
    ? [
        [header.keys.recovery, normalizeRecoveryKey(secret)],
        [header.keys.password, secret],
      ]
    : [[header.keys.password, secret]];
  let dataKey: Uint8Array | null = null;
  for (const [wrapped, s] of tries) {
    try {
      dataKey = await unwrapKey(wrapped, s);
      break;
    } catch (e) {
      if (!(e instanceof WrongSecretError)) throw e;
    }
  }
  if (!dataKey) throw new WrongSecretError();
  const { nonce, ...base } = header;
  const plain = open(dataKey, nonce, file.subarray(bodyStart), encoder.encode(JSON.stringify(base)));
  return { header, dataKey, data: JSON.parse(decoder.decode(plain)) as Snapshot };
}

/**
 * Replaces everything on this phone with the backup (replace-only, Decided
 * Nov 7). One transaction: if anything fails, nothing changes. This phone
 * keeps its own device id; the app lock is not carried over (offered after).
 */
export function restoreSnapshot(db: AppDb, data: Snapshot, input: { deviceId: string }): void {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    db.transaction((tx) => {
      for (const t of [...TABLES].reverse()) tx.delete(t).run();
      for (const t of TABLES) {
        const name = getTableName(t);
        const known = Object.keys(getTableColumns(t));
        const rows = (data[name] ?? []).map((row) => {
          const clean: Record<string, unknown> = {};
          for (const k of known) if (k in row) clean[k] = row[k];
          return clean;
        });
        if (t === schema.settings) {
          for (const r of rows) {
            r.deviceId = input.deviceId;
            r.appLockEnabled = false;
            r.pinHash = null;
            r.biometricsEnabled = false;
            r.failedPinAttempts = 0;
            r.pinLockedUntil = null;
          }
        }
        for (let i = 0; i < rows.length; i += 200) tx.insert(t).values(rows.slice(i, i + 200)).run();
      }
      const broken = tx.all(sql`PRAGMA foreign_key_check`);
      if (broken.length) throw new Error('The backup is damaged (links between records are broken).');
      if (!tx.select().from(settings).get()) throw new Error('The backup is damaged (no settings).');
    });
  } finally {
    db.run(sql`PRAGMA foreign_keys = ON`);
  }
}
