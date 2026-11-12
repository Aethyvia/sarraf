import * as Device from 'expo-device';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import type { BackupDeps, KeyStore, LocalFiles, StoredKeys } from '@/data/backup-flow';
import { db } from '@/db/client';
import { fakeCloud, type FakeStore } from './fake';
import { realCloud } from './real';
import type { Cloud } from './types';

/** The dev stand-in keeps its "cloud" in a folder that survives wiping the app's data from /dev. */
function fileStore(): FakeStore {
  const dir = new Directory(Paths.document, 'dev-cloud');
  dir.create({ intermediates: true, idempotent: true });
  return {
    read: (name) => {
      const f = new File(dir, name);
      return f.exists ? f.bytesSync() : null;
    },
    write: (name, data) => {
      const f = new File(dir, name);
      if (!f.exists) f.create();
      f.write(data);
    },
    delete: (name) => {
      const f = new File(dir, name);
      if (f.exists) f.delete();
    },
  };
}

/** Until Supabase and Google Drive are set up, release builds have no cloud. */
const notReady: Cloud = new Proxy({ ready: false } as Cloud, {
  get: (target, prop) => (prop === 'ready' ? false : prop in target ? target[prop as keyof Cloud] : () => Promise.reject(new Error('Sign-in isn’t set up yet'))),
});

/** The public Supabase and Google values from .env (none of them secret). */
const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '',
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
};
const configured = !!(config.supabaseUrl && config.supabaseKey && config.googleWebClientId);

/**
 * Dev builds use the real Supabase and Drive whenever they're configured (owner, Nov 12: Google
 * sign-in must be real). The stand-in only when /dev switches to it ('0'), or nothing is configured.
 */
export const DEV_REAL_CLOUD_KEY = 'sarraf.dev.real-cloud';
const devWantsStandIn = __DEV__ && (!configured || SecureStore.getItem(DEV_REAL_CLOUD_KEY) === '0');

export const devStore: FakeStore | null = devWantsStandIn ? fileStore() : null;
export const cloud: Cloud & { knobs?: ReturnType<typeof fakeCloud>['knobs'] } = devStore
  ? fakeCloud(devStore)
  : configured
    ? realCloud(config)
    : notReady;
/** True when this build talks to the real Supabase and Drive. */
export const usingRealCloud = !devStore && configured;

const KEYS = 'sarraf.backup-keys';

/** The backup data key and its wrapped copies, in the Android keystore. */
export const keyStore: KeyStore = {
  async get() {
    const raw = await SecureStore.getItemAsync(KEYS);
    return raw ? (JSON.parse(raw) as StoredKeys) : null;
  },
  async set(keys) {
    await SecureStore.setItemAsync(KEYS, JSON.stringify(keys), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEYS);
  },
};

export const deviceName = Device.modelName ?? 'This phone';

/** Attachment files live under the app's document folder, at the relative path on each row. */
const files: LocalFiles = {
  read: (path) => {
    const f = new File(Paths.document, path);
    return f.exists ? f.bytesSync() : null;
  },
  write: (path, data) => {
    const f = new File(Paths.document, path);
    f.parentDirectory.create({ intermediates: true, idempotent: true });
    if (!f.exists) f.create();
    f.write(data);
  },
};

export function backupDeps(): BackupDeps {
  return { db, cloud, keyStore, deviceName, files };
}
