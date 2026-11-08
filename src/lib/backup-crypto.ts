import { gcm } from '@noble/ciphers/aes.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { getRandomBytes } from 'expo-crypto';

/**
 * Backup encryption (Spec §3, Ideas added Nov 7 — Decided): one random data key
 * encrypts every backup; it is wrapped once by the backup password and once by
 * the recovery key, each through Argon2id. Never derived from the app-lock PIN.
 */

export interface KdfParams {
  /** Iterations. */
  t: number;
  /** Memory in KiB. */
  m: number;
  /** Lanes. */
  p: number;
}

/** OWASP's minimum for Argon2id; stored in each file so it can change later. */
export const DEFAULT_KDF: KdfParams = { t: 2, m: 19 * 1024, p: 1 };
/**
 * For the recovery key: it's 120 random bits, so stretching adds nothing against
 * guessing; a light setting keeps setup quick (pure JS Argon2id takes seconds).
 */
export const RECOVERY_KDF: KdfParams = { t: 1, m: 4 * 1024, p: 1 };

export interface WrappedKey {
  kdf: KdfParams;
  salt: string;
  nonce: string;
  key: string;
}

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const RECOVERY_BYTES = 15; // 120 bits → 24 characters
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export class WrongSecretError extends Error {
  constructor() {
    super('That password or recovery key doesn’t open this backup');
    this.name = 'WrongSecretError';
  }
}

export const randomBytes = (n: number): Uint8Array => getRandomBytes(n);
export const newDataKey = (): Uint8Array => randomBytes(KEY_BYTES);

/** A new recovery key, e.g. "7K2M-QX9D-…" (six groups of four). */
export function newRecoveryKey(): string {
  return formatRecoveryKey(toBase32(randomBytes(RECOVERY_BYTES)));
}

/** Upper-cases, drops spaces and dashes, and reads O as 0 and I/L as 1, so a hand-typed key still works. */
export function normalizeRecoveryKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function isRecoveryKeyShape(input: string): boolean {
  const k = normalizeRecoveryKey(input);
  return k.length === 24 && [...k].every((c) => CROCKFORD.includes(c));
}

export function formatRecoveryKey(raw: string): string {
  return (normalizeRecoveryKey(raw).match(/.{1,4}/g) ?? []).join('-');
}

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

async function kek(secret: string, salt: Uint8Array, kdf: KdfParams): Promise<Uint8Array> {
  return argon2idAsync(new TextEncoder().encode(secret), salt, { ...kdf, dkLen: KEY_BYTES, asyncTick: 20 });
}

/** Wraps the data key with a password or recovery key (recovery keys are normalized first). */
export async function wrapKey(dataKey: Uint8Array, secret: string, kdf: KdfParams = DEFAULT_KDF): Promise<WrappedKey> {
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = gcm(await kek(secret, salt, kdf), nonce).encrypt(dataKey);
  return { kdf, salt: b64(salt), nonce: b64(nonce), key: b64(sealed) };
}

/** The data key, or WrongSecretError. */
export async function unwrapKey(wrapped: WrappedKey, secret: string): Promise<Uint8Array> {
  const k = await kek(secret, unb64(wrapped.salt), wrapped.kdf);
  try {
    return gcm(k, unb64(wrapped.nonce)).decrypt(unb64(wrapped.key));
  } catch {
    throw new WrongSecretError();
  }
}

/** Encrypts with the data key; `aad` (the file header) is bound in, so editing it breaks the file. */
export function seal(dataKey: Uint8Array, plain: Uint8Array, aad: Uint8Array): { nonce: string; data: Uint8Array } {
  const nonce = randomBytes(NONCE_BYTES);
  return { nonce: b64(nonce), data: gcm(dataKey, nonce, aad).encrypt(plain) };
}

export function open(dataKey: Uint8Array, nonce: string, data: Uint8Array, aad: Uint8Array): Uint8Array {
  try {
    return gcm(dataKey, unb64(nonce), aad).decrypt(data);
  } catch {
    throw new WrongSecretError();
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function b64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

export function unb64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let j = 0;
  for (const c of clean) {
    const v = B64.indexOf(c);
    if (v < 0) throw new Error('Not base64');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      out[j++] = (value >> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return out;
}
