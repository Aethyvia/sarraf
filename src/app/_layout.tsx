import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces/700Bold';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
import { Manrope_400Regular } from '@expo-google-fonts/manrope/400Regular';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { Manrope_800ExtraBold } from '@expo-google-fonts/manrope/800ExtraBold';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useFonts } from 'expo-font';
import { router, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import migrations from '../../drizzle/migrations';
import { ensureBaseData } from '@/db/base-data';
import { db } from '@/db/client';
import { seedSampleData } from '@/db/seed';
import { purgeSoftDeleted } from '@/data/transaction-ops';
import { needsPlanChoice } from '@/data/plan-ended';
import { planChoiceDismissed } from '@/state/plan-ended';
import { usePlan } from '@/state/plan';
import { useLive } from '@/state/live';
import { backfillRecurring } from '@/data/recurring';
import type { TransactionRow } from '@/data/transactions';
import { LockGate } from '@/components/lock/LockGate';
import { loadSampleClock } from '@/dev/sample-clock';
import { nowIso } from '@/lib/dates';
import { deleteStoredFiles } from '@/services/attachments';
import { strings } from '@/i18n/strings';
import { SettingsProvider } from '@/state/settings';
import { ToastProvider } from '@/state/toast';
import { startAutomaticBackup } from '@/services/auto-backup';
import { startNotifications } from '@/services/notifications';
import { refreshRatesIfStale } from '@/services/rates';
import { setAddedWhileAway } from '@/state/away';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  const migration = useMigrations(db, migrations);
  // Runs once the schema is ready. Both steps are idempotent, so a repeat run is harmless.
  const data = useMemo<{ ready: boolean; error: Error | null; added: TransactionRow[] }>(() => {
    if (!migration.success) return { ready: false, error: null, added: [] };
    try {
      const fresh = ensureBaseData(db);
      if (__DEV__) {
        // Dev builds start with the canvas's sample data on a fresh install only,
        // so "Try first run" (Developer preview) isn't undone by a reload.
        if (fresh) seedSampleData(db);
        loadSampleClock();
      }
      // Deleted rows kept for Undo are removed for good on the next app open.
      deleteStoredFiles(purgeSoftDeleted(db, nowIso()).attachmentPaths);
      // Recurring auto-adds missed while the app was closed: one per due date, never twice.
      // Owner, Nov 14: no pop-up; Needs review and Home's review card show them.
      const added = backfillRecurring(db);
      setAddedWhileAway(added.map((t) => t.id));
      return { ready: true, error: null, added };
    } catch (e) {
      return { ready: false, error: e as Error, added: [] };
    }
  }, [migration.success]);

  const error = migration.error ?? data.error ?? fontError;
  const ready = (fontsLoaded && data.ready) || error;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Market rates refresh on app open when older than 6 hours; offline keeps the last ones.
  useEffect(() => {
    if (data.ready) refreshRatesIfStale();
  }, [data.ready]);

  // Reminders are re-planned on open and whenever data changes.
  useEffect(() => (data.ready ? startNotifications() : undefined), [data.ready]);

  // Automatic backups run when due, on open and whenever Sarraf comes back to the foreground.
  useEffect(() => (data.ready ? startAutomaticBackup() : undefined), [data.ready]);

  if (error) {
    return (
      <View style={styles.error}>
        <Text style={styles.errorTitle}>{strings.startup.migrationFailed}</Text>
        <Text style={styles.errorDetail}>{error.message}</Text>
      </View>
    );
  }
  if (!ready) return null;

  return (
    <SettingsProvider>
      <ToastProvider>
        <ThemedStack />
      </ToastProvider>
    </SettingsProvider>
  );
}

function ThemedStack() {
  const { scheme, colors } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
      <PlanEndedPrompt />
      <LockGate />
    </>
  );
}

/**
 * After Sarraf Plus ends and its 7-day grace runs out, someone over the free
 * limits is asked once per app open to renew or choose what stays active
 * (Owner, Nov 12). Closing it archives nothing.
 */
function PlanEndedPrompt() {
  const plan = usePlan();
  const pathname = usePathname();
  // Never in the middle of signing in, restoring or first-run setup.
  const busyElsewhere = pathname.startsWith('/start') || pathname.startsWith('/plan-ended') || pathname.startsWith('/lock') || pathname.startsWith('/backup');
  const needs = useLive((d) => needsPlanChoice(d, plan), [plan]);
  useEffect(() => {
    if (!needs || busyElsewhere || planChoiceDismissed()) return;
    // Let the first screen mount before stacking this one on top.
    const t = setTimeout(() => router.push('/plan-ended'), 600);
    return () => clearTimeout(t);
  }, [needs, busyElsewhere]);
  return null;
}

const styles = StyleSheet.create({
  error: { flex: 1, justifyContent: 'center', padding: 24, gap: 8 },
  errorTitle: { fontSize: 16, fontWeight: '700' },
  errorDetail: { fontSize: 13 },
});
