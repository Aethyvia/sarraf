import { GUEST, MAIN_FILE, emptyProfiles, fileForGuest, fileForSignIn, keysName, parseProfiles, recordActive, savedElsewhere, withActive, withoutFile } from '../profiles';

const T = '2026-11-14T10:00:00Z';

describe('data saved per account on this phone (owner, Nov 14)', () => {
  it('starts with the one file every install has', () => {
    expect(parseProfiles(null)).toEqual({ active: MAIN_FILE, list: [] });
    expect(parseProfiles('nonsense')).toEqual(emptyProfiles());
  });

  it('a guest who signs in keeps or replaces the guest data (the open file)', () => {
    const p = recordActive(emptyProfiles(), GUEST, null, T);
    expect(fileForSignIn(p, 'u1')).toEqual({ file: MAIN_FILE, isNew: false });
  });

  it('signing in as an account with saved data opens that file; another account gets a new one', () => {
    let p = recordActive(emptyProfiles(), 'u1', 'ali@x.com', T);
    expect(fileForSignIn(p, 'u1')).toEqual({ file: MAIN_FILE, isNew: false });
    expect(fileForSignIn(p, 'u2')).toEqual({ file: '', isNew: true });
    p = recordActive(withActive(p, 'sarraf-2.db'), 'u2', 'sana@x.com', T);
    expect(fileForSignIn(p, 'u1')).toEqual({ file: MAIN_FILE, isNew: false });
  });

  it('continue as guest opens the guest file, or a new one when the open file is an account’s', () => {
    let p = recordActive(emptyProfiles(), 'u1', 'ali@x.com', T);
    expect(fileForGuest(p)).toEqual({ file: '', isNew: true });
    p = recordActive(withActive(p, 'sarraf-g.db'), GUEST, null, T);
    p = withActive(p, MAIN_FILE);
    expect(fileForGuest(p)).toEqual({ file: 'sarraf-g.db', isNew: false });
  });

  it('lists what else is saved here, and forgets a removed file', () => {
    let p = recordActive(emptyProfiles(), 'u1', 'ali@x.com', T);
    p = recordActive(withActive(p, 'sarraf-g.db'), GUEST, null, '2026-11-14T11:00:00Z');
    expect(savedElsewhere(p).map((e) => e.email)).toEqual(['ali@x.com']);
    expect(savedElsewhere(withoutFile(p, MAIN_FILE))).toEqual([]);
  });

  it('keeps the email when the same account is recorded again without one', () => {
    let p = recordActive(emptyProfiles(), 'u1', 'ali@x.com', T);
    p = recordActive(p, 'u1', null, T);
    expect(p.list[0].email).toBe('ali@x.com');
  });

  it('each file has its own backup keys; the first keeps the old key', () => {
    expect(keysName(MAIN_FILE)).toBe('sarraf.backup-keys');
    expect(keysName('sarraf-ab12.db')).toBe('sarraf.backup-keys.sarraf-ab12.db');
  });
});
