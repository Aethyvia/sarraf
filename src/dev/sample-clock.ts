import Storage from 'expo-sqlite/kv-store';

import { SAMPLE_TODAY } from '@/db/sample';
import { pinToday } from '@/lib/dates';
const KEY = 'dev.sampleClock';

/** Dev builds only: restores whether "today" is pinned to the sample date. */
export function loadSampleClock(): boolean {
  if (!__DEV__) return false;
  const on = Storage.getItemSync(KEY) === '1';
  pinToday(on ? SAMPLE_TODAY : null);
  return on;
}

export function setSampleClock(on: boolean): void {
  if (!__DEV__) return;
  Storage.setItemSync(KEY, on ? '1' : '0');
  pinToday(on ? SAMPLE_TODAY : null);
}
