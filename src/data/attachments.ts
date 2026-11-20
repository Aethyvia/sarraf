import { and, eq, inArray, or } from 'drizzle-orm';

import { attachments, people } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { newId } from '@/lib/id';

export type AttachmentRow = typeof attachments.$inferSelect;

/** A file already moved into the app's attachments folder. */
export interface StoredFile {
  /** Relative to the app's documents folder, e.g. "attachments/<uuid>.jpg". */
  filePath: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AttachmentChanges {
  add?: StoredFile[];
  /** Existing attachment ids to remove. */
  removeIds?: string[];
}

/**
 * Adds and removes attachment rows for one owner (a transaction or a goal
 * allocation). Use inside the owner's save. Returns the removed rows' file
 * paths so the caller deletes the files after the save commits.
 */
export function applyAttachmentChanges(
  db: AppDb,
  owner: { transactionId: string } | { goalAllocationId: string },
  changes: AttachmentChanges = {},
): { removedPaths: string[] } {
  const ownerFilter =
    'transactionId' in owner ? eq(attachments.transactionId, owner.transactionId) : eq(attachments.goalAllocationId, owner.goalAllocationId);
  const removedPaths: string[] = [];
  if (changes.removeIds?.length) {
    const where = and(ownerFilter, inArray(attachments.id, changes.removeIds));
    for (const r of db.select({ p: attachments.filePath }).from(attachments).where(where).all()) removedPaths.push(r.p);
    db.delete(attachments).where(where).run();
  }
  for (const f of changes.add ?? []) {
    db.insert(attachments)
      .values({
        id: newId(),
        transactionId: 'transactionId' in owner ? owner.transactionId : null,
        goalAllocationId: 'goalAllocationId' in owner ? owner.goalAllocationId : null,
        filePath: f.filePath,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
      })
      .run();
  }
  return { removedPaths };
}

export function attachmentsOf(db: AppDb, owner: { transactionId?: string | null; goalAllocationId?: string | null }): AttachmentRow[] {
  const conditions = [
    owner.transactionId ? eq(attachments.transactionId, owner.transactionId) : undefined,
    owner.goalAllocationId ? eq(attachments.goalAllocationId, owner.goalAllocationId) : undefined,
  ].filter(Boolean);
  if (!conditions.length) return [];
  return db.select().from(attachments).where(or(...conditions)).orderBy(attachments.createdAt).all();
}

/**
 * Every stored file the data points to: attachments, and people's profile
 * pictures (owner, Nov 20). The backup uploads each once under `id` (a photo
 * uses the uuid in its file name, so a new photo is a new upload); the
 * app-open sweep keeps exactly these; Export with files includes them.
 */
export function storedFileRefs(db: AppDb): { id: string; path: string }[] {
  const out = db.select({ id: attachments.id, path: attachments.filePath }).from(attachments).all();
  for (const p of db.select({ path: people.photoPath }).from(people).all()) {
    if (p.path) out.push({ id: photoId(p.path), path: p.path });
  }
  return out;
}

/** A profile picture's id in the backup: the uuid its file is named by. */
export function photoId(path: string): string {
  return path.split('/').pop()!.replace(/\.[^.]+$/, '');
}
