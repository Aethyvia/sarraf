import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { eq } from 'drizzle-orm';

import { settings } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { b64, randomBytes, unb64, unwrapKey, WrongSecretError, isRecoveryKeyShape, normalizeRecoveryKey } from '@/lib/backup-crypto';
import type { KeyStore } from './backup-flow';

/**
 * App lock (Spec §4 — Decided): Sarraf's own PIN, 4 digits or 6, stored only as
 * a salted hash. Wrong tries never delete data; after FREE_TRIES the waits grow.
 * The PIN never touches the backup key.
 */
export const FREE_TRIES = 5;
/** Waits after each wrong try past the free ones, in seconds; the last repeats. */
export const WAITS = [30, 60, 120, 300, 900, 1800, 3600];
const ITERATIONS = 20_000;

export function hashPin(pin: string, salt: Uint8Array = randomBytes(16)): string {
  const h = pbkdf2(sha256, new TextEncoder().encode(pin), salt, { c: ITERATIONS, dkLen: 32 });
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(h)}`;
}

function matches(pin: string, stored: string): boolean {
  const [alg, iter, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2-sha256') return false;
  const h = b64(pbkdf2(sha256, new TextEncoder().encode(pin), unb64(salt), { c: Number(iter), dkLen: 32 }));
  // Same length always; compare every character.
  let diff = h.length ^ hash.length;
  for (let i = 0; i < Math.min(h.length, hash.length); i++) diff |= h.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export function isValidPin(pin: string, length: 4 | 6): boolean {
  return new RegExp(`^\\d{${length}}$`).test(pin);
}

/** "Avoid easy ones like 1234 or your birth year": same digit, straight runs, or a year. */
export function isEasyPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const up = '01234567890123456789';
  const down = '98765432109876543210';
  if (up.includes(pin) || down.includes(pin)) return true;
  return pin.length === 4 && /^(19|20)\d\d$/.test(pin);
}

function update(db: AppDb, values: Partial<typeof settings.$inferInsert>): void {
  db.update(settings).set(values).where(eq(settings.id, 1)).run();
}

/** Turns the lock on with a new PIN (also "Change PIN" and the reset after Forgot PIN). */
export function setPin(db: AppDb, pin: string, length: 4 | 6): void {
  if (!isValidPin(pin, length)) throw new Error(`Enter ${length} digits`);
  update(db, { appLockEnabled: true, pinHash: hashPin(pin), pinLength: length, failedPinAttempts: 0, pinLockedUntil: null });
}

export function turnOffLock(db: AppDb): void {
  update(db, { appLockEnabled: false, pinHash: null, biometricsEnabled: false, failedPinAttempts: 0, pinLockedUntil: null });
}

export type PinCheck = { ok: true } | { ok: false; waitUntil: string | null; triesLeft: number };

/** Seconds still to wait before another try (0 when free to try). */
export function waitLeft(db: AppDb, now: Date): number {
  const until = db.select({ u: settings.pinLockedUntil }).from(settings).where(eq(settings.id, 1)).get()?.u;
  return until ? Math.max(0, Math.ceil((new Date(until).getTime() - now.getTime()) / 1000)) : 0;
}

/** Checks a PIN. A try during a wait isn't counted (and isn't checked). */
export function checkPin(db: AppDb, pin: string, now: Date): PinCheck {
  const s = db.select().from(settings).where(eq(settings.id, 1)).get()!;
  if (!s.pinHash) return { ok: true };
  if (waitLeft(db, now) > 0) return { ok: false, waitUntil: s.pinLockedUntil, triesLeft: 0 };
  if (matches(pin, s.pinHash)) {
    update(db, { failedPinAttempts: 0, pinLockedUntil: null });
    return { ok: true };
  }
  const failed = s.failedPinAttempts + 1;
  const over = failed - FREE_TRIES;
  const waitUntil = over >= 0 ? new Date(now.getTime() + WAITS[Math.min(over, WAITS.length - 1)] * 1000).toISOString() : null;
  update(db, { failedPinAttempts: failed, pinLockedUntil: waitUntil });
  return { ok: false, waitUntil, triesLeft: Math.max(0, FREE_TRIES - failed) };
}

/**
 * Forgot PIN: the backup password (or recovery key) proves it's you, then a new
 * PIN can be set. Without backup there's no reset (Decided Nov 7).
 */
export async function proveWithBackupSecret(keyStore: KeyStore, secret: string): Promise<boolean> {
  const stored = await keyStore.get();
  if (!stored) return false;
  try {
    if (isRecoveryKeyShape(secret)) await unwrapKey(stored.keys.recovery, normalizeRecoveryKey(secret));
    else await unwrapKey(stored.keys.password, secret);
    return true;
  } catch (e) {
    if (e instanceof WrongSecretError) return false;
    throw e;
  }
}

/** Whether the app should lock now: lock is on and it's been in the background at least "Lock after". */
export function shouldLock(lockEnabled: boolean, lockAfterSeconds: number, backgroundSince: number | null, now: number): boolean {
  if (!lockEnabled || backgroundSince === null) return false;
  return now - backgroundSince >= lockAfterSeconds * 1000;
}
