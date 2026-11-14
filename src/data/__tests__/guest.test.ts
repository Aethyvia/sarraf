import { showGuestReminder } from '../guest';

const base = { signedIn: false, onboardedAt: '2026-11-01T10:00:00Z', transactionCount: 0, dismissedAt: null, now: '2026-11-03T10:00:00Z' };

describe('guest reminder on Home (owner, Nov 14)', () => {
  it('waits for 7 days or 20 transactions', () => {
    expect(showGuestReminder(base)).toBe(false);
    expect(showGuestReminder({ ...base, now: '2026-11-08T10:00:00Z' })).toBe(true);
    expect(showGuestReminder({ ...base, transactionCount: 20 })).toBe(true);
  });
  it('comes back 30 days after Not now', () => {
    const later = { ...base, transactionCount: 25, dismissedAt: '2026-11-03T10:00:00Z' };
    expect(showGuestReminder({ ...later, now: '2026-11-20T10:00:00Z' })).toBe(false);
    expect(showGuestReminder({ ...later, now: '2026-12-03T10:00:00Z' })).toBe(true);
  });
  it('never shows once signed in, or before setup is done', () => {
    expect(showGuestReminder({ ...base, transactionCount: 50, signedIn: true })).toBe(false);
    expect(showGuestReminder({ ...base, transactionCount: 50, onboardedAt: null })).toBe(false);
  });
});
