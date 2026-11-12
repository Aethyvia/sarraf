/** Whether the lock screen is up right now (LockGate keeps it current), so tours wait until it's gone. */
let lockedNow = false;

export function setLockedNow(v: boolean): void {
  lockedNow = v;
}

export function isLockedNow(): boolean {
  return lockedNow;
}
