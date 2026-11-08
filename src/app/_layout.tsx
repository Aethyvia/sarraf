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
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import migrations from '../../drizzle/migrations';
import { ensureBaseData } from '@/db/base-data';
import { db } from '@/db/client';
import { seedSampleData } from '@/db/seed';
import { purgeSoftDeleted } from '@/data/transaction-ops';
import { loadSampleClock } from '@/dev/sample-clock';
import { nowIso } from '@/lib/dates';
import { deleteStoredFiles } from '@/services/attachments';
import { strings } from '@/i18n/strings';
import { SettingsProvider } from '@/state/settings';
import { ToastProvider } from '@/state/toast';
import { refreshRatesIfStale } from '@/services/rates';
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
  const data = useMemo<{ ready: boolean; error: Error | null }>(() => {
    if (!migration.success) return { ready: false, error: null };
    try {
      ensureBaseData(db);
      if (__DEV__) {
        seedSampleData(db);
        loadSampleClock();
      }
      // Deleted rows kept for Undo are removed for good on the next app open.
      deleteStoredFiles(purgeSoftDeleted(db, nowIso()).attachmentPaths);
      return { ready: true, error: null };
    } catch (e) {
      return { ready: false, error: e as Error };
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
    </>
  );
}

const styles = StyleSheet.create({
  error: { flex: 1, justifyContent: 'center', padding: 24, gap: 8 },
  errorTitle: { fontSize: 16, fontWeight: '700' },
  errorDetail: { fontSize: 13 },
});
