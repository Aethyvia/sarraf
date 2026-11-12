import { eq } from 'drizzle-orm';

import { settings } from '@/db/schema';
import type { AppDb } from '@/db/types';

/** First-visit tours (FieldTips board): each shows once, until seen or skipped. */
function seenList(db: AppDb): string[] {
  try {
    return JSON.parse(db.select({ t: settings.toursSeen }).from(settings).where(eq(settings.id, 1)).get()?.t ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function tourSeen(db: AppDb, id: string): boolean {
  return seenList(db).includes(id);
}

export function markTourSeen(db: AppDb, id: string): void {
  const list = seenList(db);
  if (list.includes(id)) return;
  db.update(settings).set({ toursSeen: JSON.stringify([...list, id]) }).where(eq(settings.id, 1)).run();
}

/** Settings → Show the tips again. */
export function resetTours(db: AppDb): void {
  db.update(settings).set({ toursSeen: '[]' }).where(eq(settings.id, 1)).run();
}
