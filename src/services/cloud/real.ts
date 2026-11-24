import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import Storage from 'expo-sqlite/kv-store';
import * as WebBrowser from 'expo-web-browser';
import { AppState } from 'react-native';

import type { BackupRecord, Cloud, CloudUser, SignInMethod } from './types';
import { BadCodeError, CancelledError, DriveError, DriveRefusedError, OfflineError } from './types';

/**
 * The real services (Decided, see the Spec): Supabase for sign-in, the backup
 * record and the subscription; the user's own Google Drive app-data folder
 * for the encrypted backup and attachments. No money data goes to Supabase.
 */

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export interface RealCloudConfig {
  supabaseUrl: string;
  supabaseKey: string;
  googleWebClientId: string;
}

/** Network failures look different on each path; all of them mean "You're offline". */
function isNetworkError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /network request failed|failed to fetch|network error|timed? ?out|ENOTFOUND|ECONNREFUSED/i.test(m);
}
/** Turns a failed Drive response into an error that says what happened. */
async function driveProblem(res: Response): Promise<Error> {
  let reason = '';
  let message = '';
  try {
    const body = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = body.error?.errors?.[0]?.reason ?? '';
    message = body.error?.message ?? '';
  } catch {
    // Not JSON: the status says enough.
  }
  const detail = `Google Drive ${res.status}${reason ? ` ${reason}` : ''}${message ? `: ${message}` : ''}`;
  if (reason === 'storageQuotaExceeded' || reason === 'quotaExceeded') return new DriveError('full', res.status, detail);
  if (res.status === 429 || /rateLimit/i.test(reason)) return new DriveError('busy', res.status, detail);
  if (res.status === 401 || res.status === 403) return new DriveRefusedError();
  if (res.status >= 500) return new DriveError('unavailable', res.status, detail);
  return new DriveError('other', res.status, detail);
}

/**
 * Files Delete backup removes: this account's backup and attachments only.
 * Old shared names from before Nov 14 aren't supported (council, owner Nov 14:
 * pre-release, only test backups had them), and another account's files are never matched.
 */
export function isThisAccountsFile(file: string, backupName: string, attachmentPrefix: string): boolean {
  return file === backupName || file.startsWith(attachmentPrefix);
}

async function online<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isNetworkError(e)) throw new OfflineError();
    throw e;
  }
}

/**
 * Google sign-in is a native module: it exists in the Sarraf builds made with
 * EAS, not inside Expo Go. Loaded on first use so the rest still works there.
 */
type GoogleModule = typeof import('@react-native-google-signin/google-signin');
let google: GoogleModule | null = null;
function googleSignIn(webClientId: string): GoogleModule {
  if (google) return google;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    google = require('@react-native-google-signin/google-signin') as GoogleModule;
  } catch {
    throw new Error('Google sign-in needs the Sarraf app build; it can’t run inside Expo Go.');
  }
  google.GoogleSignin.configure({ webClientId, offlineAccess: false });
  return google;
}

const methodOf = (u: User): SignInMethod => {
  const p = u.app_metadata?.provider;
  return p === 'google' || p === 'github' ? p : 'email';
};
const toCloudUser = (u: User): CloudUser => ({ id: u.id, email: u.email ?? '', method: methodOf(u) });

export function realCloud(config: RealCloudConfig): Cloud {
  const supabase: SupabaseClient = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { storage: Storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
  });
  // Refresh the session only while the app is in front (Supabase's advice for React Native).
  AppState.addEventListener('change', (state) => (state === 'active' ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh()));

  const g = () => googleSignIn(config.googleWebClientId);

  /** Turns a Google sign-in result into "cancelled" or the signed-in data. */
  function googleData<T extends { type: string }>(res: T | null): Extract<T, { type: 'success' }> {
    if (!res || res.type !== 'success') throw new CancelledError();
    return res as Extract<T, { type: 'success' }>;
  }

  async function nativeGoogleSignIn(scopes: string[] = []) {
    const { GoogleSignin, isErrorWithCode, statusCodes } = g();
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      return googleData(await GoogleSignin.signIn({ scopes } as never)).data;
    } catch (e) {
      if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) throw new CancelledError();
      throw e;
    }
  }

  // ── Drive (app-data folder only) ──
  /** A Drive access token for the Google account Drive was connected with. */
  async function driveToken(): Promise<string> {
    const { GoogleSignin } = g();
    if (!GoogleSignin.getCurrentUser()) {
      const silent = await GoogleSignin.signInSilently();
      if (silent.type !== 'success') throw new DriveRefusedError();
    }
    const { accessToken } = await GoogleSignin.getTokens();
    return accessToken;
  }

  async function drive(path: string, init: RequestInit = {}, base = DRIVE): Promise<Response> {
    return online(async () => {
      let token = await driveToken();
      const send = () => fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
      let res = await send();
      if (res.status === 401) {
        // An expired token: Google sign-in hands out a fresh one.
        await g().GoogleSignin.clearCachedAccessToken(token);
        token = await driveToken();
        res = await send();
      }
      if (!res.ok && res.status !== 404) throw await driveProblem(res);
      return res;
    });
  }

  type DriveFile = { id: string; name: string; size?: string; modifiedTime: string };
  async function listFiles(query: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let page: string | undefined;
    do {
      const params = new URLSearchParams({ spaces: 'appDataFolder', q: query, fields: 'nextPageToken, files(id, name, size, modifiedTime)', pageSize: '1000' });
      if (page) params.set('pageToken', page);
      const body = (await (await drive(`/files?${params}`)).json()) as { files: DriveFile[]; nextPageToken?: string };
      out.push(...body.files);
      page = body.nextPageToken;
    } while (page);
    return out;
  }
  const byName = async (name: string) => (await listFiles(`name = '${name.replace(/'/g, "\\'")}' and trashed = false`))[0] ?? null;

  async function writeFile(name: string, data: Uint8Array): Promise<void> {
    let file = await byName(name);
    if (!file) {
      const res = await drive('/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parents: ['appDataFolder'] }) });
      file = (await res.json()) as DriveFile;
    }
    await drive(`/files/${file.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: data as unknown as BodyInit }, DRIVE_UPLOAD);
  }
  async function readFile(id: string): Promise<Uint8Array> {
    const res = await drive(`/files/${id}?alt=media`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async function removeFile(name: string): Promise<void> {
    const file = await byName(name);
    if (file) await drive(`/files/${file.id}`, { method: 'DELETE' });
  }

  /**
   * Each Sarraf account's files carry its id (owner, Nov 14): two people can
   * back up to one Google Drive and never see or touch each other's backup.
   */
  async function ownerId(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error('Not signed in');
    return id;
  }
  const backupName = async () => `sarraf-backup-${await ownerId()}.bin`;
  const attachmentPrefix = async () => `att-${await ownerId()}-`;
  const backupFile = async () => byName(await backupName());

  async function session(): Promise<User> {
    const { data, error } = await online(() => supabase.auth.getUser());
    if (error || !data.user) throw new Error('Not signed in');
    return data.user;
  }

  return {
    ready: true,

    async signIn(method) {
      if (method === 'google') {
        const data = await online(() => nativeGoogleSignIn());
        if (!data.idToken) throw new Error('Google didn’t return a sign-in token');
        const { data: auth, error } = await online(() => supabase.auth.signInWithIdToken({ provider: 'google', token: data.idToken! }));
        if (error || !auth.user) throw error ?? new Error('Sign-in failed');
        return toCloudUser(auth.user);
      }
      // GitHub: a browser page, then back to the app with a one-time code.
      const redirectTo = Linking.createURL('auth-callback');
      const { data, error } = await online(() => supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo, skipBrowserRedirect: true } }));
      if (error || !data.url) throw error ?? new Error('Sign-in failed');
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success') throw new CancelledError();
      const code = new URL(result.url).searchParams.get('code');
      if (!code) throw new Error('GitHub didn’t finish the sign-in');
      const { data: auth, error: exchange } = await online(() => supabase.auth.exchangeCodeForSession(code));
      if (exchange || !auth.user) throw exchange ?? new Error('Sign-in failed');
      return toCloudUser(auth.user);
    },

    async sendEmailCode(email) {
      const { error } = await online(() => supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
      if (error) throw error;
    },

    async verifyEmailCode(email, code) {
      const { data, error } = await online(() => supabase.auth.verifyOtp({ email, token: code, type: 'email' }));
      if (error || !data.user) throw new BadCodeError();
      return toCloudUser(data.user);
    },

    async signOut() {
      await supabase.auth.signOut({ scope: 'local' });
      try {
        await google?.GoogleSignin.signOut();
      } catch {
        // Not signed in to Google on this phone: nothing to do.
      }
    },

    async getRecord(user) {
      const { data, error } = await online(async () => supabase.from('backup_records').select('*').eq('user_id', user.id).maybeSingle());
      if (error) throw error;
      if (!data) return null;
      return {
        driveEmail: data.drive_email,
        lastBackupAt: data.last_backup_at,
        deviceId: data.device_id,
        deviceName: data.device_name,
        sizeBytes: Number(data.size_bytes),
        counts: data.counts,
        format: data.format,
      } satisfies BackupRecord;
    },

    async putRecord(user, r) {
      const { error } = await online(async () =>
        supabase.from('backup_records').upsert({
          user_id: user.id,
          drive_email: r.driveEmail,
          last_backup_at: r.lastBackupAt,
          device_id: r.deviceId,
          device_name: r.deviceName,
          size_bytes: r.sizeBytes,
          counts: r.counts,
          format: r.format,
          updated_at: new Date().toISOString(),
        }),
      );
      if (error) throw error;
    },

    async deleteRecord(user) {
      const { error } = await online(async () => supabase.from('backup_records').delete().eq('user_id', user.id));
      if (error) throw error;
    },

    async connectDrive(options) {
      const { GoogleSignin } = g();
      if (options?.another) {
        try {
          await GoogleSignin.signOut();
        } catch {
          // Nothing to sign out of.
        }
      }
      // Already signed in with Google: ask for the app-data folder on top. Otherwise pick an account for Drive.
      const current = !options?.another ? GoogleSignin.getCurrentUser() : null;
      try {
        const data = current ? googleData(await online(() => GoogleSignin.addScopes({ scopes: [DRIVE_SCOPE] }))).data : await online(() => nativeGoogleSignIn([DRIVE_SCOPE]));
        if (!data.scopes?.includes(DRIVE_SCOPE)) throw new DriveRefusedError();
        return { email: data.user.email };
      } catch (e) {
        if (e instanceof CancelledError || e instanceof OfflineError || e instanceof DriveRefusedError) throw e;
        throw new DriveRefusedError();
      }
    },

    async findBackup() {
      const file = await backupFile();
      return file ? { modifiedAt: file.modifiedTime, sizeBytes: Number(file.size ?? 0) } : null;
    },

    async downloadBackup(onProgress) {
      const file = await backupFile();
      if (!file) throw new Error('No backup in this Drive');
      const total = Number(file.size ?? 0);
      onProgress?.(0, total);
      const bytes = await readFile(file.id);
      onProgress?.(bytes.length, bytes.length);
      return bytes;
    },

    async uploadBackup(file) {
      await writeFile(await backupName(), file);
    },

    async listAttachments() {
      const prefix = await attachmentPrefix();
      const files = await listFiles(`name contains '${prefix}' and trashed = false`);
      return files.filter((f) => f.name.startsWith(prefix)).map((f) => f.name.slice(prefix.length));
    },
    uploadAttachment: async (name, file) => writeFile((await attachmentPrefix()) + name, file),
    async downloadAttachment(name) {
      const file = await byName((await attachmentPrefix()) + name);
      return file ? readFile(file.id) : null;
    },
    deleteAttachment: async (name) => removeFile((await attachmentPrefix()) + name),

    async testSubscribe(_user, kind) {
      const { error } = await online(async () => supabase.rpc('test_subscribe', { kind }));
      if (error) throw error;
    },

    async getSubscription(user) {
      // A supporter's email on the owner's list becomes lifetime Plus here (owner, Nov 14).
      await online(async () => supabase.rpc('claim_supporter')).catch(() => {});
      const { data, error } = await online(async () => supabase.from('subscriptions').select('plan, renews_at, source').eq('user_id', user.id).maybeSingle());
      if (error) throw error;
      return data ? { plan: 'plus', renewsAt: data.renews_at ?? null, lifetime: data.source === 'supporter' } : null;
    },

    async redeemCode(_user, code) {
      const { data, error } = await online(async () => supabase.rpc('redeem_supporter_code', { code }));
      if (error) throw error;
      return data === 'ok' || data === 'used' || data === 'expired' ? data : 'unknown';
    },

    async deleteBackup() {
      // Only this Sarraf account's files: someone else's backup in the same Drive stays.
      const [name, prefix] = [await backupName(), await attachmentPrefix()];
      for (const f of await listFiles('trashed = false')) {
        if (isThisAccountsFile(f.name, name, prefix)) await drive(`/files/${f.id}`, { method: 'DELETE' });
      }
    },

    async deleteAccount(user) {
      await session().then((u) => {
        if (u.id !== user.id) throw new Error('Signed in as someone else');
      });
      const { error } = await online(async () => supabase.rpc('delete_my_account'));
      if (error) throw error;
      await supabase.auth.signOut({ scope: 'local' });
    },
  };
}
