import * as Device from 'expo-device';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import type { BackupDeps, KeyStore, LocalFiles, StoredKeys } from '@/data/backup-flow';
import { db } from '@/db/client';
import { fakeCloud, type FakeStore } from './fake';
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
  };
}

/** Until Supabase and Google Drive are set up, release builds have no cloud. */
const notReady: Cloud = new Proxy({ ready: false } as Cloud, {
  get: (target, prop) => (prop === 'ready' ? false : prop in target ? target[prop as keyof Cloud] : () => Promise.reject(new Error('Sign-in isn’t set up yet'))),
});

export const cloud: Cloud & { knobs?: ReturnType<typeof fakeCloud>['knobs'] } = __DEV__ ? fakeCloud(fileStore()) : notReady;

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
