import { eq } from 'drizzle-orm';

import { ensureBaseData } from '@/db/base-data';
import { settings } from '@/db/schema';
import { createTestDb } from '@/test/db';
import { checkPin, FREE_TRIES, isEasyPin, proveWithBackupSecret, setPin, shouldLock, turnOffLock, waitLeft } from '../app-lock';
import { memoryKeyStore, startBackupSetup } from '../backup-flow';

async function db() {
  const d = await createTestDb();
  ensureBaseData(d);
  return d;
}

describe('app lock', () => {
  it('stores only a salted hash and checks the PIN', async () => {
    const d = await db();
    setPin(d, '4821', 4);
    const s = d.select().from(settings).get()!;
    expect(s.appLockEnabled).toBe(true);
    expect(s.pinHash).not.toContain('4821');
    expect(checkPin(d, '4821', new Date())).toEqual({ ok: true });
    expect(checkPin(d, '1111', new Date())).toMatchObject({ ok: false, triesLeft: FREE_TRIES - 1 });
    setPin(d, '482193', 6);
    expect(checkPin(d, '482193', new Date())).toEqual({ ok: true });
    expect(() => setPin(d, '12', 4)).toThrow();
  });

  it('waits grow after the free tries; wrong tries never delete anything; a right PIN resets', async () => {
    const d = await db();
    setPin(d, '4821', 4);
    let now = new Date('2026-09-30T10:00:00Z');
    for (let i = 0; i < FREE_TRIES - 1; i++) expect(checkPin(d, '0000', now)).toMatchObject({ waitUntil: null });
    expect(checkPin(d, '0000', now)).toMatchObject({ triesLeft: 0, waitUntil: '2026-09-30T10:00:30.000Z' });
    expect(waitLeft(d, now)).toBe(30);
    // During a wait even the right PIN isn't checked.
    expect(checkPin(d, '4821', now)).toMatchObject({ ok: false });
    now = new Date('2026-09-30T10:00:31Z');
    expect(checkPin(d, '0000', now)).toMatchObject({ waitUntil: '2026-09-30T10:01:31.000Z' });
    now = new Date('2026-09-30T10:01:32Z');
    expect(checkPin(d, '4821', now)).toEqual({ ok: true });
    expect(d.select().from(settings).get()!.failedPinAttempts).toBe(0);
  });

  it('turning off clears the PIN', async () => {
    const d = await db();
    setPin(d, '4821', 4);
    turnOffLock(d);
    const s = d.select().from(settings).where(eq(settings.id, 1)).get()!;
    expect([s.appLockEnabled, s.pinHash]).toEqual([false, null]);
  });

  it('flags easy PINs', () => {
    for (const p of ['1234', '0000', '4321', '1987', '2001', '123456']) expect(isEasyPin(p)).toBe(true);
    for (const p of ['4821', '9035', '482193']) expect(isEasyPin(p)).toBe(false);
  });

  it('forgot PIN: the backup password or recovery key proves it; without backup nothing does', async () => {
    const d = await db();
    const keyStore = memoryKeyStore();
    expect(await proveWithBackupSecret(keyStore, 'anything')).toBe(false);
    const started = startBackupSetup({ db: d, keyStore, cloud: {} as never, deviceName: 'x' }, 'backup-pass');
    await started.finished;
    expect(await proveWithBackupSecret(keyStore, 'backup-pass')).toBe(true);
    expect(await proveWithBackupSecret(keyStore, started.recoveryKey)).toBe(true);
    expect(await proveWithBackupSecret(keyStore, 'nope')).toBe(false);
  }, 30000);

  it('locks after the chosen time in the background', () => {
    expect(shouldLock(true, 60, 0, 59_000)).toBe(false);
    expect(shouldLock(true, 60, 0, 60_000)).toBe(true);
    expect(shouldLock(true, 0, 0, 1)).toBe(true);
    expect(shouldLock(false, 0, 0, 10_000)).toBe(false);
  });
});
