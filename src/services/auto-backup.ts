import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

import { automaticBackupDue, backupNow, currentUser, noteBackupFailed } from '@/data/backup-flow';
import { refreshPlan } from '@/data/plan';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { backupDeps, cloud } from './cloud';
import { notificationsAllowed } from './notifications';
import { eq } from 'drizzle-orm';
import { settings } from '@/db/schema';

let running = false;

/** Runs a due automatic backup (Spec §3: daily / weekly / manual, Wi-Fi only can be turned off). */
export async function runAutomaticBackup(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const net = await Network.getNetworkStateAsync();
    const network = { online: !!net.isConnected && net.isInternetReachable !== false, wifi: net.type === Network.NetworkStateType.WIFI };
    if (!automaticBackupDue(db, new Date(), network)) return;
    const result = await backupNow(backupDeps());
    if (!result.ok && result.reason === 'moved') await tellMoved(result.movedTo ?? '');
  } catch {
    // Tried and failed (offline, Drive error): noted; "Backup problems" speaks up after 3 days.
    noteBackupFailed(db, new Date().toISOString());
  } finally {
    running = false;
  }
}

/** The old phone learns its backups moved: tell the person once, if they want backup notices. */
async function tellMoved(device: string): Promise<void> {
  const on = db.select({ v: settings.notifyBackupProblems }).from(settings).where(eq(settings.id, 1)).get()?.v;
  if (!on || !(await notificationsAllowed())) return;
  await Notifications.scheduleNotificationAsync({
    identifier: 'backup-moved',
    content: { title: strings.notifications.backupMoved(device), body: strings.notifications.backupMovedBody, data: { route: '/backup' } },
    trigger: null,
  });
}

/** Checks on app open and every time Sarraf comes back to the foreground. */
export function startAutomaticBackup(): () => void {
  void runAutomaticBackup();
  // The cached plan is refreshed on open (offline keeps the cache, with its 7-day grace).
  const user = currentUser(db);
  if (user && cloud.ready) void refreshPlan(db, cloud, user, new Date()).catch(() => {});
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void runAutomaticBackup();
  });
  return () => sub.remove();
}
