import { exportToEncryptedSql, fromHex, isSealed, keyPragma, newLocalKeys, openFile, parseLocalKeys, sealFile, toHex } from '../local-crypto';

// Deterministic "random" bytes for tests.
const counter = () => {
  let i = 0;
  return (n: number) => Uint8Array.from({ length: n }, () => i++ % 256);
};

describe('local keys', () => {
  it('makes two different 256-bit keys', () => {
    const k = newLocalKeys(counter());
    expect(k.db).toMatch(/^[0-9a-f]{64}$/);
    expect(k.files).toMatch(/^[0-9a-f]{64}$/);
    expect(k.db).not.toBe(k.files);
  });

  it('round-trips through storage and rejects damaged values', () => {
    const k = newLocalKeys(counter());
    expect(parseLocalKeys(JSON.stringify(k))).toEqual(k);
    expect(parseLocalKeys(null)).toBeNull();
    expect(parseLocalKeys('not json')).toBeNull();
    expect(parseLocalKeys(JSON.stringify({ db: 'abc', files: k.files }))).toBeNull();
    expect(parseLocalKeys(JSON.stringify({ db: k.db.toUpperCase(), files: k.files }))).toBeNull();
  });

  it('hex round-trips', () => {
    const b = Uint8Array.from([0, 1, 15, 16, 255]);
    expect(toHex(b)).toBe('00010f10ff');
    expect(fromHex('00010f10ff')).toEqual(b);
    expect(() => fromHex('zz')).toThrow();
  });
});

describe('SQLCipher statements', () => {
  const key = 'a'.repeat(64);

  it('uses the raw key form', () => {
    expect(keyPragma(key)).toBe(`PRAGMA key = "x'${key}'";`);
  });

  it('never builds a statement from a bad key or path', () => {
    expect(() => keyPragma("'; DROP TABLE accounts; --")).toThrow();
    expect(() => keyPragma('a'.repeat(63))).toThrow();
    expect(() => exportToEncryptedSql("/data/x'.db", key)).toThrow();
    expect(() => exportToEncryptedSql('/data/x.db', 'nope')).toThrow();
  });

  it('copies into the encrypted file and detaches it', () => {
    const sql = exportToEncryptedSql('/data/db/sarraf-1.encrypting', key);
    expect(sql).toContain(`ATTACH DATABASE '/data/db/sarraf-1.encrypting' AS sarraf_encrypted KEY "x'${key}'"`);
    expect(sql).toContain("SELECT sqlcipher_export('sarraf_encrypted')");
    expect(sql).toContain('DETACH DATABASE sarraf_encrypted');
  });
});

describe('attachment files', () => {
  const key = fromHex('11'.repeat(32));
  const photo = new TextEncoder().encode('a receipt photo');

  it('round-trips and hides the contents', () => {
    const sealed = sealFile(key, photo, 'attachments/abc.jpg', counter());
    expect(isSealed(sealed)).toBe(true);
    expect(new TextDecoder().decode(sealed)).not.toContain('receipt');
    expect(openFile(key, sealed, 'attachments/abc.jpg')).toEqual(photo);
  });

  it('reads files saved before encryption as they are', () => {
    expect(isSealed(photo)).toBe(false);
    expect(openFile(key, photo, 'attachments/old.jpg')).toEqual(photo);
  });

  it('refuses another key, another path, or a changed byte', () => {
    const sealed = sealFile(key, photo, 'attachments/abc.jpg', counter());
    expect(() => openFile(fromHex('22'.repeat(32)), sealed, 'attachments/abc.jpg')).toThrow();
    expect(() => openFile(key, sealed, 'attachments/other.jpg')).toThrow();
    const bent = sealed.slice();
    bent[bent.length - 1] ^= 1;
    expect(() => openFile(key, bent, 'attachments/abc.jpg')).toThrow();
  });

  it('uses a fresh nonce each time', () => {
    const r = counter();
    expect(sealFile(key, photo, 'p', r)).not.toEqual(sealFile(key, photo, 'p', r));
  });
});
