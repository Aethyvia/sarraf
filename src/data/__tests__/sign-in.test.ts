import { decideAfterSignIn, isAccountSwitch } from '../sign-in';

const me = 'phone-a';
const base = { userId: 'u1', thisDeviceId: me };

describe('after sign-in', () => {
  it.each([
    ['brand-new phone, no backup', { hasData: false, prevUserId: null, record: null }, 'setup'],
    ['new phone with a backup', { hasData: false, prevUserId: null, record: { deviceId: 'phone-b' } }, 'found'],
    ['data, never signed in, no backup', { hasData: true, prevUserId: null, record: null }, 'hasData'],
    ['data, never signed in, a backup', { hasData: true, prevUserId: null, record: { deviceId: 'phone-b' } }, 'hasData'],
    ['same account signing back in', { hasData: true, prevUserId: 'u1', record: { deviceId: me } }, 'home'],
    ['same account, no backup yet', { hasData: true, prevUserId: 'u1', record: null }, 'home'],
    ['same account, another phone took the backup', { hasData: true, prevUserId: 'u1', record: { deviceId: 'phone-b' } }, 'hasData'],
    ['a different account on a phone with data', { hasData: true, prevUserId: 'u2', record: null }, 'hasData'],
  ] as const)('%s', (_name, facts, expected) => {
    expect(decideAfterSignIn({ ...base, ...facts })).toBe(expected);
  });

  it('knows an account switch', () => {
    expect(isAccountSwitch({ prevUserId: 'u2', userId: 'u1' })).toBe(true);
    expect(isAccountSwitch({ prevUserId: null, userId: 'u1' })).toBe(false);
    expect(isAccountSwitch({ prevUserId: 'u1', userId: 'u1' })).toBe(false);
  });
});
