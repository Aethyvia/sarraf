import { pauseLockFor } from '@/state/lock-pause';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';

import { strings } from '@/i18n/strings';
import { db } from '@/db/client';
import { storedFileRefs } from '@/data/attachments';
import { newId } from '@/lib/id';
import { isSealed, openFile, sealFile } from '@/lib/local-crypto';
import { fileKey } from '@/services/local-keys';

/**
 * Attachments (Decided Nov 7): photo, gallery or any file, no size limit.
 * Photos are shrunk automatically to save space on the phone and in the
 * backup; other files are kept as they are. Files live in the app's own
 * attachments folder, stored by a path relative to it (absolute paths break on
 * a new phone).
 */
export interface PickedFile {
  /** Where the file is now: a temporary copy until the transaction is saved. */
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** For shrunk photos: the size before shrinking. */
  originalBytes?: number;
}

/** The longest side a photo keeps after shrinking. */
const PHOTO_MAX_SIDE = 2000;
const PHOTO_QUALITY = 0.75;
const FOLDER = 'attachments';

function attachmentsDir(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

async function shrinkPhoto(asset: { uri: string; width: number; height: number; fileName?: string | null; fileSize?: number }): Promise<PickedFile> {
  const longest = Math.max(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  if (longest > PHOTO_MAX_SIDE) {
    context.resize(asset.width >= asset.height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE });
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: PHOTO_QUALITY, format: SaveFormat.JPEG });
  const shrunk = new File(result.uri);
  // Camera photos come with a random name; give them a readable one ("photo_nov7.jpg").
  const fromCamera = !asset.fileName || /^[0-9a-f-]{20,}\./i.test(asset.fileName);
  const now = new Date();
  const base = fromCamera
    ? `photo_${strings.dates.months[now.getMonth()].toLowerCase()}${now.getDate()}`
    : asset.fileName!.replace(/\.[^.]+$/, '');
  return {
    uri: result.uri,
    name: `${base}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: shrunk.size ?? 0,
    originalBytes: asset.fileSize ?? new File(asset.uri).size ?? undefined,
  };
}

/** Take a photo with the camera. Null when cancelled or not allowed. */
export async function takePhoto(): Promise<PickedFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  pauseLockFor();
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets[0]) return null;
  return shrinkPhoto(result.assets[0]);
}

/** Choose photos from the gallery. */
export async function choosePhotos(): Promise<PickedFile[]> {
  pauseLockFor();
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1 });
  if (result.canceled) return [];
  return Promise.all(result.assets.map(shrinkPhoto));
}

/** Choose any file (PDF, etc.); kept as it is. */
export async function chooseFiles(): Promise<PickedFile[]> {
  pauseLockFor();
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return result.assets.map((a) => ({
    uri: a.uri,
    name: a.name,
    mimeType: a.mimeType ?? 'application/octet-stream',
    sizeBytes: a.size ?? new File(a.uri).size ?? 0,
  }));
}

/**
 * Moves picked files into the app's attachments folder. Returns each file's
 * stored relative path, in order. On failure, files already moved are removed.
 */
export async function storeFiles(files: PickedFile[]): Promise<string[]> {
  const dir = attachmentsDir();
  const stored: string[] = [];
  try {
    for (const f of files) {
      const ext = /\.[A-Za-z0-9]{1,8}$/.exec(f.name)?.[0] ?? '';
      const name = `${newId()}${ext.toLowerCase()}`;
      const path = `${FOLDER}/${name}`;
      // Encrypted on the way in (owner, Nov 20); the readable copy picked or shrunk is removed below.
      writeStoredFile(path, new File(f.uri).bytesSync());
      stored.push(path);
    }
    // The readable copies picked or shrunk into the cache aren't needed now.
    for (const f of files) {
      try {
        const src = new File(f.uri);
        if (f.uri.startsWith(Paths.cache.uri) && src.exists) src.delete();
      } catch {
        // clearTempFiles removes it later.
      }
    }
    return stored;
  } catch (e) {
    deleteStoredFiles(stored);
    throw e;
  }
}

/** A stored attachment's contents, decrypted. Null when the file is missing. */
export function readStoredFile(relativePath: string): Uint8Array | null {
  const f = new File(Paths.document, relativePath);
  return f.exists ? openFile(fileKey(), f.bytesSync(), relativePath) : null;
}

/** Saves an attachment's contents, encrypted with this phone's key, at a relative path. */
export function writeStoredFile(relativePath: string, plain: Uint8Array): void {
  const f = new File(Paths.document, relativePath);
  f.parentDirectory.create({ intermediates: true, idempotent: true });
  if (!f.exists) f.create();
  f.write(sealFile(fileKey(), plain, relativePath));
}

/**
 * Attachments saved before encryption are encrypted in place on app open
 * (idempotent: already-encrypted files are skipped).
 */
export function sealOldFiles(relativePaths: string[]): { sealed: number; failed: number } {
  let n = 0;
  let failed = 0;
  for (const p of relativePaths) {
    try {
      const f = new File(Paths.document, p);
      if (!f.exists) continue;
      const bytes = f.bytesSync();
      if (isSealed(bytes)) continue;
      f.write(sealFile(fileKey(), bytes, p));
      n += 1;
    } catch {
      // Left as it is; tried again on the next open.
      failed += 1;
    }
  }
  return { sealed: n, failed };
}

/** Runs sealOldFiles once per data file on this phone (remembered in the keystore). */
export function sealOldFilesOnce(dataFile: string, relativePaths: () => string[]): void {
  const flag = `sarraf.filesSealed.${dataFile.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  if (SecureStore.getItem(flag) === '1') return;
  if (sealOldFiles(relativePaths()).failed === 0) SecureStore.setItem(flag, '1');
}

/** Removes stored files (after their rows are deleted). Missing files are ignored. */
export function deleteStoredFiles(relativePaths: string[]): void {
  for (const p of relativePaths) {
    try {
      const f = new File(Paths.document, p);
      if (f.exists) f.delete();
    } catch {
      // A file that can't be removed only costs space; its row is already gone.
    }
  }
}

/** "412 KB", "3.8 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Erasing the open data: removes its attachment files. Only this data's files:
 * other accounts saved on this phone keep theirs (owner, Nov 14).
 */
export function deleteAllStoredFiles(): void {
  deleteStoredFiles(storedFileRefs(db).map((r) => r.path));
  clearTempFiles();
}

/**
 * Copies left in the app's cache: exports and the recovery key shared from
 * Sarraf, photos and files picked or shrunk (owner, Nov 14: no residue).
 */
export function clearTempFiles(): void {
  try {
    for (const item of new Directory(Paths.cache).list()) {
      if (item instanceof File && /\.(csv|pdf|json|txt|sarraf)$/i.test(item.name)) item.delete();
      else if (item instanceof Directory && /^(ImagePicker|ImageManipulator|DocumentPicker)$/.test(item.name)) item.delete();
    }
  } catch {
    // Nothing cached.
  }
}
