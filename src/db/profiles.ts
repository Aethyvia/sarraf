/**
 * Data saved per account on this phone (owner, Nov 14): every Sarraf account
 * that signed in here keeps its own database file, and there's one for the
 * guest. Only one is open at a time. A saved account opens only after signing
 * in as that account; its own app lock PIN (if it set one) then applies.
 *
 * Pure bookkeeping, so it can be tested without a phone. `owner` is the Sarraf
 * user id, or 'guest'.
 */
export const GUEST = 'guest';
/** The file every install started with; it keeps its name. */
export const MAIN_FILE = 'sarraf.db';

export interface ProfileEntry {
  file: string;
  owner: string;
  email: string | null;
  /** Last time this one was open. */
  usedAt: string;
}

export interface Profiles {
  active: string;
  list: ProfileEntry[];
}

export const emptyProfiles = (): Profiles => ({ active: MAIN_FILE, list: [] });

export function parseProfiles(raw: string | null): Profiles {
  if (!raw) return emptyProfiles();
  try {
    const p = JSON.parse(raw) as Profiles;
    return p && typeof p.active === 'string' && Array.isArray(p.list) ? p : emptyProfiles();
  } catch {
    return emptyProfiles();
  }
}

/** Records who the open file belongs to now (after sign-in, sign-out, a wipe). */
export function recordActive(p: Profiles, owner: string, email: string | null, now: string): Profiles {
  const others = p.list.filter((e) => e.file !== p.active);
  const before = p.list.find((e) => e.file === p.active);
  return { ...p, list: [...others, { file: p.active, owner, email: email ?? (before?.owner === owner ? before.email : null), usedAt: now }] };
}

export const fileOf = (p: Profiles, owner: string): string | null => p.list.find((e) => e.owner === owner)?.file ?? null;
export const ownerOfActive = (p: Profiles): string | null => p.list.find((e) => e.file === p.active)?.owner ?? null;

export function withActive(p: Profiles, file: string): Profiles {
  return { ...p, active: file };
}

export function withoutFile(p: Profiles, file: string): Profiles {
  return { ...p, list: p.list.filter((e) => e.file !== file) };
}

/** Saved on this phone besides the open one, newest first (Settings). */
export function savedElsewhere(p: Profiles): ProfileEntry[] {
  return p.list.filter((e) => e.file !== p.active).sort((a, b) => b.usedAt.localeCompare(a.usedAt));
}

/**
 * Which file a sign-in opens (owner, Nov 14):
 * - that account's own saved file, wherever it is;
 * - else the open file, when it's the guest's (a guest signing in to back up keeps or replaces it);
 * - else a new empty file (the open one belongs to someone else).
 */
export function fileForSignIn(p: Profiles, userId: string): { file: string; isNew: boolean } {
  const own = fileOf(p, userId);
  if (own) return { file: own, isNew: false };
  const activeOwner = ownerOfActive(p);
  if (!activeOwner || activeOwner === GUEST) return { file: p.active, isNew: false };
  return { file: '', isNew: true };
}

/** Continue as guest: the guest's file, or a new one. */
export function fileForGuest(p: Profiles): { file: string; isNew: boolean } {
  const activeOwner = ownerOfActive(p);
  if (!activeOwner || activeOwner === GUEST) return { file: p.active, isNew: false };
  const guest = fileOf(p, GUEST);
  return guest ? { file: guest, isNew: false } : { file: '', isNew: true };
}

/** SecureStore key for a file's backup keys (the first file keeps the old key). */
export function keysName(file: string): string {
  return file === MAIN_FILE ? 'sarraf.backup-keys' : `sarraf.backup-keys.${file.replace(/[^A-Za-z0-9._-]/g, '')}`;
}
