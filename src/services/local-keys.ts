import * as SecureStore from 'expo-secure-store';

import { fromHex, newLocalKeys, parseLocalKeys, type LocalKeys } from '@/lib/local-crypto';

/**
 * This phone's local keys (lib/local-crypto), made once on first use and kept in
 * the Android keystore. They are never backed up, shared or sent anywhere: a
 * restore on a new phone gets that phone's own keys.
 */
const NAME = 'sarraf.localKeys';
let cached: LocalKeys | null = null;

export function localKeys(): LocalKeys {
  if (cached) return cached;
  let k = parseLocalKeys(SecureStore.getItem(NAME));
  if (!k) {
    k = newLocalKeys();
    SecureStore.setItem(NAME, JSON.stringify(k), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  }
  cached = k;
  return k;
}

export const fileKey = (): Uint8Array => fromHex(localKeys().files);
