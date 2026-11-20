import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { b64 } from '@/lib/backup-crypto';
import { newId } from '@/lib/id';
import { pauseLockFor } from '@/state/lock-pause';
import { deleteStoredFiles, readStoredFile, writeStoredFile } from './attachments';

/**
 * People's profile pictures (owner, Nov 20): from the camera or the gallery,
 * cropped square, shrunk, and stored encrypted next to attachments (so they're
 * backed up and swept the same way).
 */
const SIDE = 512;
const QUALITY = 0.8;

/** Takes or chooses a photo, crops it square and stores it. Returns its path, or null when cancelled or not allowed. */
export async function pickPersonPhoto(source: 'camera' | 'gallery'): Promise<string | null> {
  if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return null;
  pauseLockFor();
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const context = ImageManipulator.manipulate(asset.uri);
  // The editor keeps it square; crop the middle anyway in case it didn't.
  const side = Math.min(asset.width, asset.height);
  if (asset.width !== asset.height) context.crop({ originX: (asset.width - side) / 2, originY: (asset.height - side) / 2, width: side, height: side });
  if (side > SIDE) context.resize({ width: SIDE, height: SIDE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
  const path = `attachments/${newId()}.jpg`;
  const temp = new File(saved.uri);
  try {
    writeStoredFile(path, temp.bytesSync());
  } finally {
    try {
      if (temp.exists) temp.delete();
    } catch {
      // The app-open sweep clears temp copies.
    }
  }
  return path;
}

const cache = new Map<string, string | null>();

/** The photo as an image URI to show (decrypted in memory), or null when its file is missing. */
export function personPhotoUri(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!cache.has(path)) {
    let uri: string | null = null;
    try {
      const bytes = readStoredFile(path);
      uri = bytes ? `data:image/jpeg;base64,${b64(bytes)}` : null;
    } catch {
      uri = null;
    }
    // Missing files aren't remembered, so a photo restored later shows up.
    if (uri) cache.set(path, uri);
    return uri;
  }
  return cache.get(path) ?? null;
}

/** Removes a photo file that's no longer used. */
export function deletePersonPhotoFile(path: string | null): void {
  if (!path) return;
  cache.delete(path);
  deleteStoredFiles([path]);
}
