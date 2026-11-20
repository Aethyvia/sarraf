import { gcm } from '@noble/ciphers/aes.js';
import { getRandomBytes } from 'expo-crypto';

/**
 * Encryption of the money data on this phone (owner, Nov 20 — Decided).
 * One pair of random keys per phone, kept in the Android keystore (never in the
 * app's files): `db` encrypts every database file with SQLCipher, `files`
 * encrypts every attachment with AES-256-GCM. Separate from the backup keys
 * (Spec §3), which travel with the backup; these never leave the phone.
 */
export interface LocalKeys {
  /** 32 bytes, hex: the SQLCipher raw key. */
  db: string;
  /** 32 bytes, hex: the attachment key. */
  files: string;
}

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const HEX64 = /^[0-9a-f]{64}$/;

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export function fromHex(h: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(h)) throw new Error('Not hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function newLocalKeys(random: (n: number) => Uint8Array = getRandomBytes): LocalKeys {
  return { db: toHex(random(KEY_BYTES)), files: toHex(random(KEY_BYTES)) };
}

/** Null when missing or damaged. */
export function parseLocalKeys(raw: string | null | undefined): LocalKeys | null {
  if (!raw) return null;
  try {
    const k = JSON.parse(raw) as Partial<LocalKeys>;
    return typeof k.db === 'string' && typeof k.files === 'string' && HEX64.test(k.db) && HEX64.test(k.files) ? { db: k.db, files: k.files } : null;
  } catch {
    return null;
  }
}

/** The SQLCipher statement that unlocks a database with a raw 256-bit key (no password stretching needed: the key is random). */
export function keyPragma(dbKeyHex: string): string {
  if (!HEX64.test(dbKeyHex)) throw new Error('Bad database key');
  return `PRAGMA key = "x'${dbKeyHex}'";`;
}

/** The statement that copies an open, unencrypted database into a new encrypted file. */
export function exportToEncryptedSql(targetPath: string, dbKeyHex: string): string {
  if (!HEX64.test(dbKeyHex)) throw new Error('Bad database key');
  if (/['"\0]/.test(targetPath)) throw new Error('Bad path');
  return `ATTACH DATABASE '${targetPath}' AS sarraf_encrypted KEY "x'${dbKeyHex}'"; SELECT sqlcipher_export('sarraf_encrypted'); DETACH DATABASE sarraf_encrypted;`;
}

/**
 * Attachment file format: "SRF1" · 12-byte nonce · AES-GCM ciphertext and tag.
 * The file's stored path is bound in, so a file can't be swapped for another.
 */
const MAGIC = new Uint8Array([0x53, 0x52, 0x46, 0x31]);

export function isSealed(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length + NONCE_BYTES + 16 && MAGIC.every((m, i) => bytes[i] === m);
}

export function sealFile(key: Uint8Array, plain: Uint8Array, path: string, random: (n: number) => Uint8Array = getRandomBytes): Uint8Array {
  const nonce = random(NONCE_BYTES);
  const ct = gcm(key, nonce, new TextEncoder().encode(path)).encrypt(plain);
  const out = new Uint8Array(MAGIC.length + NONCE_BYTES + ct.length);
  out.set(MAGIC, 0);
  out.set(nonce, MAGIC.length);
  out.set(ct, MAGIC.length + NONCE_BYTES);
  return out;
}

/** Decrypts a sealed attachment. A file saved before encryption (no "SRF1") is returned as it is. */
export function openFile(key: Uint8Array, bytes: Uint8Array, path: string): Uint8Array {
  if (!isSealed(bytes)) return bytes;
  const nonce = bytes.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES);
  return gcm(key, nonce, new TextEncoder().encode(path)).decrypt(bytes.subarray(MAGIC.length + NONCE_BYTES));
}
