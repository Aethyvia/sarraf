import {
  b64,
  formatRecoveryKey,
  isRecoveryKeyShape,
  newDataKey,
  newRecoveryKey,
  normalizeRecoveryKey,
  open,
  seal,
  unb64,
  unwrapKey,
  wrapKey,
  WrongSecretError,
} from '../backup-crypto';

// Light settings so tests run fast; real backups use DEFAULT_KDF (kept in each file).
const KDF = { t: 1, m: 64, p: 1 };
const enc = (s: string) => new TextEncoder().encode(s);

describe('backup crypto', () => {
  it('one data key, opened by the password or the recovery key, not by anything else', async () => {
    const key = newDataKey();
    const recovery = newRecoveryKey();
    const byPassword = await wrapKey(key, 'correct horse', KDF);
    const byRecovery = await wrapKey(key, normalizeRecoveryKey(recovery), KDF);
    expect(await unwrapKey(byPassword, 'correct horse')).toEqual(key);
    expect(await unwrapKey(byRecovery, normalizeRecoveryKey(recovery.toLowerCase().replace(/-/g, ' ')))).toEqual(key);
    await expect(unwrapKey(byPassword, 'wrong')).rejects.toBeInstanceOf(WrongSecretError);
    await expect(unwrapKey(byRecovery, 'correct horse')).rejects.toBeInstanceOf(WrongSecretError);
  });

  it('seals data with the header bound in', () => {
    const key = newDataKey();
    const sealed = seal(key, enc('hello'), enc('{"v":1}'));
    expect(new TextDecoder().decode(open(key, sealed.nonce, sealed.data, enc('{"v":1}')))).toBe('hello');
    expect(() => open(key, sealed.nonce, sealed.data, enc('{"v":2}'))).toThrow(WrongSecretError);
    expect(() => open(newDataKey(), sealed.nonce, sealed.data, enc('{"v":1}'))).toThrow(WrongSecretError);
  });

  it('recovery keys: 24 characters in groups of four, forgiving to type', () => {
    const k = newRecoveryKey();
    expect(k).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(isRecoveryKeyShape(k.toLowerCase().replace(/-/g, ' '))).toBe(true);
    expect(normalizeRecoveryKey('o1l i-')).toBe('0111');
    expect(formatRecoveryKey('abcdefgh')).toBe('ABCD-EFGH');
    expect(isRecoveryKeyShape('ABCD')).toBe(false);
  });

  it('base64 round trip', () => {
    for (const n of [0, 1, 2, 3, 4, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
      expect(unb64(b64(bytes))).toEqual(bytes);
      expect(b64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});
