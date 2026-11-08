import { eq } from 'drizzle-orm';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Note } from '@/components/start/StartPage';
import { BottomSheet, Card, Header, Screen, SectionLabel, SheetOption, ToggleRow } from '@/components/ui';
import { turnOffLock } from '@/data/app-lock';
import { getDeviceState } from '@/data/backup-flow';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { useLive } from '@/state/live';
import { goBack } from '@/state/nav';
import { useSettings } from '@/state/settings';
import { useToast } from '@/state/toast';
import { fonts, useTheme } from '@/theme';

const LOCK_AFTER = [0, 60, 300, 900, 3600];

/** Settings → App lock (App lock settings board). */
export default function AppLockScreen() {
  const s = strings.lock;
  const { colors } = useTheme();
  const toast = useToast();
  const set = useSettings();
  const backupOn = useLive(() => getDeviceState(db).backupEnabled, []);
  const [picking, setPicking] = useState(false);
  const [bioReady, setBioReady] = useState(false);
  const save = (v: Partial<typeof settings.$inferInsert>) => db.update(settings).set(v).where(eq(settings.id, 1)).run();
  const on = set.appLockEnabled && !!set.pinHash;

  useEffect(() => {
    void LocalAuthentication.hasHardwareAsync().then(async (hw) => setBioReady(hw && (await LocalAuthentication.isEnrolledAsync())));
  }, []);

  return (
    <Screen>
      <Header title={s.title} onBack={goBack} />
      <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        <ToggleRow title={s.lockWithPin} detail={s.lockWithPinDetail} value={on} onChange={(v) => (v ? router.push('/lock/set') : turnOffLock(db))} />
      </Card>

      {on ? (
        <>
          <SectionLabel>{s.unlocking}</SectionLabel>
          <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
            <ToggleRow
              title={s.biometrics}
              detail={bioReady ? s.biometricsDetail : s.biometricsMissing}
              value={set.biometricsEnabled}
              onChange={(v) => (bioReady || !v ? save({ biometricsEnabled: v }) : toast({ message: s.biometricsMissing }))}
            />
            <Row title={s.changePin} onPress={() => router.push({ pathname: '/lock/set', params: { change: '1' } })} border />
            <Row title={s.lockAfter} detail={s.lockAfterDetail} value={s.lockAfterOptions[set.lockAfterSeconds] ?? `${set.lockAfterSeconds} s`} onPress={() => setPicking(true)} border />
          </Card>
        </>
      ) : null}

      <SectionLabel>{s.privacy}</SectionLabel>
      <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        <ToggleRow title={s.hideRecents} detail={s.hideRecentsDetail} value={set.hideInRecents} onChange={(v) => save({ hideInRecents: v })} />
      </Card>

      {on ? (
        <Note tone={backupOn ? 'teal' : 'amber'} icon={backupOn ? 'tick' : 'lock'}>
          <Text style={{ fontFamily: fonts.sansBold }}>{s.coveredTitle}</Text>
          {backupOn ? s.covered : s.notCovered}
        </Note>
      ) : null}
      <Text style={[styles.small, { color: colors.inkMuted }]}>{s.backupsRun}</Text>

      <BottomSheet visible={picking} onClose={() => setPicking(false)} title={s.lockAfter}>
        {LOCK_AFTER.map((sec) => (
          <SheetOption
            key={sec}
            title={s.lockAfterOptions[sec]}
            selected={set.lockAfterSeconds === sec}
            onPress={() => {
              save({ lockAfterSeconds: sec });
              setPicking(false);
            }}
          />
        ))}
      </BottomSheet>
    </Screen>
  );
}

function Row({ title, detail, value, onPress, border }: { title: string; detail?: string; value?: string; onPress: () => void; border?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.row, border && { borderTopWidth: 1, borderTopColor: colors.line }]} accessibilityRole="button">
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
        {detail ? <Text style={[styles.small, { color: colors.inkMuted, textAlign: 'left' }]}>{detail}</Text> : null}
      </View>
      {value ? <Text style={[styles.value, { color: colors.inkMuted }]}>{value}</Text> : null}
      <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  value: { fontFamily: fonts.sans, fontSize: 13 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, textAlign: 'center' },
});
