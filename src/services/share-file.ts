import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { pauseLockFor } from '@/state/lock-pause';

/** Writes a file to the cache and opens the share sheet (Save to Files, Drive, email…). */
export async function shareFile(name: string, content: Uint8Array | string, mimeType: string): Promise<void> {
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  f.write(content);
  pauseLockFor();
  await Sharing.shareAsync(f.uri, { mimeType, dialogTitle: name });
}

/** Reads a picked file's text (through fetch, which can read wherever the picker put it). */
export async function readPickedText(uri: string): Promise<string> {
  const res = await fetch(uri);
  return res.text();
}
