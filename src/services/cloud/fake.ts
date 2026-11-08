import type { BackupRecord, Cloud, CloudUser } from './types';
import { BadCodeError, DriveRefusedError, OfflineError } from './types';

/** Where the stand-in keeps its "cloud": memory in tests, files on the phone in dev. */
export interface FakeStore {
  read(name: string): Uint8Array | null;
  write(name: string, data: Uint8Array): void;
  delete?(name: string): void;
}

export function memoryStore(): FakeStore {
  const files = new Map<string, Uint8Array>();
  return { read: (n) => files.get(n) ?? null, write: (n, d) => void files.set(n, d), delete: (n) => void files.delete(n) };
}

/** Dev stand-in for the Play Store: buying Plus records a subscription in the fake "cloud". */
export function grantFakePlus(store: FakeStore, renewsAt: string): void {
  store.write('subscription.json', enc.encode(JSON.stringify({ plan: 'plus', renewsAt })));
}

export interface FakeKnobs {
  offline: boolean;
  refuseDrive: boolean;
  /** Fails a download part-way, for "The restore didn't finish". */
  dropDownload: boolean;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * A stand-in for Supabase + Google Drive, so first run, backup and restore can
 * be built and tried before the real services exist. Sign-in always succeeds
 * as dev@sarraf.local; the email code is 123456.
 */
export function fakeCloud(store: FakeStore, knobs: FakeKnobs = { offline: false, refuseDrive: false, dropDownload: false }): Cloud & { knobs: FakeKnobs } {
  const user: CloudUser = { id: 'dev-user', email: 'dev@sarraf.local', method: 'dev' };
  const online = () => {
    if (knobs.offline) throw new OfflineError();
  };
  let driveEmail = 'dev@sarraf.local';
  const driveFile = () => `drive-${driveEmail}.bin`;
  return {
    ready: true,
    knobs,
    async signIn(method) {
      online();
      return { ...user, method };
    },
    async sendEmailCode() {
      online();
    },
    async verifyEmailCode(email, code) {
      online();
      if (code !== '123456') throw new BadCodeError();
      return { id: 'dev-user', email, method: 'email' };
    },
    async signOut() {},
    async getRecord() {
      online();
      const raw = store.read('record.json');
      return raw ? (JSON.parse(dec.decode(raw)) as BackupRecord) : null;
    },
    async putRecord(_u, record) {
      online();
      store.write('record.json', enc.encode(JSON.stringify(record)));
    },
    async connectDrive(options) {
      online();
      if (knobs.refuseDrive) throw new DriveRefusedError();
      if (options?.another) driveEmail = driveEmail === 'dev@sarraf.local' ? 'other@sarraf.local' : 'dev@sarraf.local';
      return { email: driveEmail };
    },
    async findBackup() {
      online();
      const f = store.read(driveFile());
      if (!f) return null;
      const meta = store.read(`${driveFile()}.meta`);
      return { modifiedAt: meta ? dec.decode(meta) : new Date(0).toISOString(), sizeBytes: f.length };
    },
    async downloadBackup(onProgress) {
      online();
      const f = store.read(driveFile());
      if (!f) throw new Error('No backup in this Drive');
      onProgress?.(Math.floor(f.length * 0.62), f.length);
      if (knobs.dropDownload) throw new OfflineError();
      onProgress?.(f.length, f.length);
      return f;
    },
    async uploadBackup(file) {
      online();
      store.write(driveFile(), file);
      store.write(`${driveFile()}.meta`, enc.encode(new Date().toISOString()));
    },
    async listAttachments() {
      online();
      const raw = store.read(`${driveFile()}.attachments`);
      return raw ? (JSON.parse(dec.decode(raw)) as string[]) : [];
    },
    async uploadAttachment(name, file) {
      online();
      store.write(`${driveFile()}.att.${name}`, file);
      const raw = store.read(`${driveFile()}.attachments`);
      const names = new Set(raw ? (JSON.parse(dec.decode(raw)) as string[]) : []);
      names.add(name);
      store.write(`${driveFile()}.attachments`, enc.encode(JSON.stringify([...names])));
    },
    async downloadAttachment(name) {
      online();
      return store.read(`${driveFile()}.att.${name}`);
    },
    async getSubscription() {
      online();
      const raw = store.read('subscription.json');
      return raw ? (JSON.parse(dec.decode(raw)) as { plan: 'plus'; renewsAt: string | null }) : null;
    },
    async deleteBackup() {
      online();
      const raw = store.read(`${driveFile()}.attachments`);
      for (const n of raw ? (JSON.parse(dec.decode(raw)) as string[]) : []) store.write(`${driveFile()}.att.${n}`, new Uint8Array());
      store.write(`${driveFile()}.attachments`, enc.encode('[]'));
      store.delete?.(driveFile());
      store.delete?.(`${driveFile()}.meta`);
    },
    async deleteAccount() {
      online();
      store.delete?.('record.json');
      store.delete?.('subscription.json');
    },
    async deleteAttachment(name) {
      online();
      const raw = store.read(`${driveFile()}.attachments`);
      const names = (raw ? (JSON.parse(dec.decode(raw)) as string[]) : []).filter((n) => n !== name);
      store.write(`${driveFile()}.attachments`, enc.encode(JSON.stringify(names)));
      store.write(`${driveFile()}.att.${name}`, new Uint8Array());
    },
  };
}
