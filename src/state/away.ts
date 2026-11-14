import { useSyncExternalStore } from 'react';

/**
 * Recurring items added while Sarraf was closed (owner, Nov 14: no pop-up on
 * open; they're shown on Needs review, and Home's review card says so). Kept
 * for this app session until confirmed, cancelled or dismissed there.
 */
let ids: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setAddedWhileAway(next: string[]) {
  ids = next;
  emit();
}

/** Forget them (after Cancel all or Got it). */
export function clearAddedWhileAway() {
  setAddedWhileAway([]);
}

export function useAddedWhileAway(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => ids,
  );
}
