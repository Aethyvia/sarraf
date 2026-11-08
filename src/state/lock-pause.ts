/**
 * Sarraf's own trips out of the app (share sheet, file or photo picker,
 * fingerprint prompt) shouldn't lock it on return. Call before opening one.
 */
let pausedUntil = 0;

export function pauseLockFor(ms = 10 * 60 * 1000): void {
  pausedUntil = Date.now() + ms;
}

/** Called when Sarraf comes back: true if the trip out was one of ours (and clears it). */
export function consumeLockPause(): boolean {
  const paused = Date.now() < pausedUntil;
  pausedUntil = 0;
  return paused;
}
