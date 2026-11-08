import { eq } from 'drizzle-orm';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RecoveryKeyCard } from '@/components/backup/RecoveryKeyCard';
import { Icon } from '@/components/icons/Icon';
import { parts } from '@/components/parts';
import { Note } from '@/components/start/StartPage';
import { BottomSheet, Button, Card, Field, Header, LinkButton, Screen, SheetOption, ToggleRow } from '@/components/ui';
import { backupNow, changeBackupPassword, currentUser, getDeviceState, makeThisTheBackupPhone, renewRecoveryKey, type StoredKeys } from '@/data/backup-flow';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { backupDeps, keyStore } from '@/services/cloud';
import { useLive } from '@/state/live';
import { goBack } from '@/state/nav';
import { useSettings } from '@/state/settings';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  return `${formatShortDate(iso.slice(0, 10))}, ${time}`;
}

/** Settings → Backup (Backup board; Spec §3): where, how often, last backup, password, recovery key, restore. */
export default function BackupScreen() {
  const s = strings.backup;
  const { colors } = useTheme();
  const toast = useToast();
  const set = useSettings();
  const state = useLive(() => getDeviceState(db), []);
  const user = currentUser(db);
  const [stored, setStored] = useState<StoredKeys | null>(null);
  const [sheet, setSheet] = useState<'frequency' | 'password' | 'renew' | 'take' | null>(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState(['', '']);
  const [pwError, setPwError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  useEffect(() => {
    void keyStore.get().then(setStored);
  }, [state.backupEnabled, sheet]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast({ message: (e as Error).message || s.failed });
    } finally {
      setBusy(false);
    }
  };

  const backUp = () =>
    run(async () => {
      const r = await backupNow(backupDeps());
      if (r.ok) toast({ message: s.backedUp });
      else if (r.reason === 'moved') toast({ message: s.moved(r.movedTo ?? '') });
      else toast({ message: s.failed });
    });

  const saveSettings = (values: Partial<typeof settings.$inferInsert>) => db.update(settings).set(values).where(eq(settings.id, 1)).run();

  if (state.backupMovedAt) {
    const device = state.backupMovedTo ?? '';
    return (
      <Screen>
        <Header title={s.title} onBack={goBack} />
        <View style={[styles.hero, { backgroundColor: colors.warningSoft }]}>
          <Icon name="phone" size={28} color={colors.warning} strokeWidth={1.8} />
        </View>
        <Text style={[styles.h1, { color: colors.ink }]}>{s.movedTitle}</Text>
        <Text style={[styles.body, { color: colors.inkSecondary }]}>
          {parts(s.movedBody(<Text key="d" style={{ color: colors.ink, fontFamily: fonts.sansBold }}>{device}</Text>, formatShortDate(state.backupMovedAt.slice(0, 10))))}
        </Text>
        <Note tone="amber" icon="bell">
          {s.movedWarn}
        </Note>
        <Text style={[styles.small, { color: colors.inkMuted }]}>{s.movedHint(device)}</Text>
        <View style={{ gap: 10, marginTop: 12 }}>
          <Button label={s.restoreNewest} onPress={() => router.push('/backup/restore')} />
          <Button label={s.makeBackupPhone} kind="secondary" onPress={() => setSheet('take')} />
        </View>
        <BottomSheet visible={sheet === 'take'} onClose={() => setSheet(null)} title={s.makeBackupPhone}>
          <View style={{ gap: 12 }}>
            <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.makeBackupPhoneConfirm(device)}</Text>
            <Button
              label={busy ? s.working : s.makeBackupPhone}
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const r = await makeThisTheBackupPhone(backupDeps());
                  setSheet(null);
                  toast({ message: r.ok ? s.backedUp : s.failed });
                })
              }
            />
            <Button label={strings.common.cancel} kind="secondary" onPress={() => setSheet(null)} />
          </View>
        </BottomSheet>
      </Screen>
    );
  }

  if (!state.backupEnabled) {
    return (
      <Screen>
        <Header title={s.title} onBack={goBack} />
        <View style={[styles.hero, { backgroundColor: colors.filled }]}>
          <Icon name="cloud" size={28} color={colors.inkSecondary} strokeWidth={1.8} />
        </View>
        <Text style={[styles.h1, { color: colors.ink }]}>{s.offTitle}</Text>
        <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.offBody}</Text>
        {user ? <Button label={s.turnOn} onPress={() => router.push('/backup/turn-on')} /> : <Note tone="amber">{s.signedOut}</Note>}
        {user ? (
          <View style={{ gap: 6, marginTop: 8 }}>
            <Button label={s.restore} kind="secondary" onPress={() => router.push('/backup/restore')} />
            <Text style={[styles.small, { color: colors.inkMuted, textAlign: 'center' }]}>{s.restoreNote}</Text>
          </View>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={s.title} onBack={goBack} />
      <Card style={styles.driveCard}>
        <View style={[styles.driveIcon, { backgroundColor: colors.accentSoft }]}>
          <Icon name="layers" size={17} color={colors.accent} strokeWidth={1.9} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.ink }]}>{state.driveEmail ?? user?.email ?? ''}</Text>
          <Text style={[styles.small, { color: colors.inkMuted }]}>{s.connected}</Text>
        </View>
        <Text style={[styles.badge, { color: colors.accent, backgroundColor: colors.accentSoft }]}>{s.on}</Text>
      </Card>

      <ToggleRow title={s.automatic} value={set.backupFrequency !== 'manual'} onChange={(v) => saveSettings({ backupFrequency: v ? 'daily' : 'manual' })} />
      <Pressable onPress={() => setSheet('frequency')} style={[styles.select, { backgroundColor: colors.filled }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.lbl, { color: colors.inkMuted }]}>{s.frequency}</Text>
          <Text style={[styles.title, { color: colors.ink, fontSize: 13.5 }]}>{s.frequencyValue(set.backupFrequency, set.backupWifiOnly)}</Text>
          <Text style={[styles.tiny, { color: colors.inkMuted }]}>{s.frequencyHint}</Text>
        </View>
        <Icon name="down" size={12} color={colors.inkMuted} strokeWidth={2.2} />
      </Pressable>

      <Card style={{ padding: 16 }}>
        <Text style={[styles.lbl, { color: colors.inkMuted }]}>{s.lastBackup}</Text>
        <Text style={[styles.title, { color: colors.ink, marginTop: 3 }]}>{state.lastBackupAt ? when(state.lastBackupAt) : s.never}</Text>
        <Text style={[styles.small, { color: colors.inkMuted, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line }]}>{s.lastNote}</Text>
      </Card>
      <Button label={busy ? s.backingUp : s.backUpNow} disabled={busy} onPress={() => void backUp()} />

      <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.ink }]}>{s.password}</Text>
            {stored?.passwordSetAt ? <Text style={[styles.small, { color: colors.inkMuted }]}>{s.passwordSet(`${formatShortDate(stored.passwordSetAt.slice(0, 10))}, ${stored.passwordSetAt.slice(0, 4)}`)}</Text> : null}
          </View>
          <LinkButton label={s.change} onPress={() => (setPw(['', '']), setPwError(null), setSheet('password'))} />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.ink }]}>{s.recoveryKey}</Text>
            <Text style={[styles.small, { color: colors.inkMuted }]}>{s.recoveryDetail}</Text>
          </View>
          <LinkButton label={s.renew} onPress={() => (setNewKey(null), setSheet('renew'))} />
        </View>
      </Card>

      <View style={{ gap: 6, marginTop: 12 }}>
        <Button label={s.restore} kind="secondary" onPress={() => router.push('/backup/restore')} />
        <Text style={[styles.small, { color: colors.inkMuted, textAlign: 'center' }]}>{s.restoreNote}</Text>
      </View>

      <BottomSheet visible={sheet === 'frequency'} onClose={() => setSheet(null)} title={s.frequency}>
        {(['daily', 'weekly', 'manual'] as const).map((f) => (
          <SheetOption key={f} title={s.frequencies[f]} selected={set.backupFrequency === f} onPress={() => saveSettings({ backupFrequency: f })} />
        ))}
        <ToggleRow title={s.wifiOnly} detail={s.wifiOnlyDetail} value={set.backupWifiOnly} onChange={(v) => saveSettings({ backupWifiOnly: v })} />
      </BottomSheet>

      <BottomSheet visible={sheet === 'password'} onClose={() => setSheet(null)} title={s.changeTitle}>
        <View style={{ gap: 12 }}>
          <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.changeBody}</Text>
          <Field label={s.newPassword} value={pw[0]} onChangeText={(v) => (setPw([v, pw[1]]), setPwError(null))} secureTextEntry autoCapitalize="none" placeholder={strings.start.passwordHint} />
          <Field label={strings.start.passwordAgain} value={pw[1]} onChangeText={(v) => (setPw([pw[0], v]), setPwError(null))} secureTextEntry autoCapitalize="none" />
          {pwError ? <Note tone="red">{pwError}</Note> : null}
          <Button
            label={busy ? s.working : s.change}
            disabled={busy}
            onPress={() => {
              if (pw[0].length < 8) return setPwError(strings.start.passwordShort);
              if (pw[0] !== pw[1]) return setPwError(strings.start.passwordMismatch);
              void run(async () => {
                await changeBackupPassword(backupDeps(), pw[0]);
                setSheet(null);
                toast({ message: s.changed });
                await backupNow(backupDeps());
              });
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === 'renew'} onClose={() => setSheet(null)} title={newKey ? s.renewTitle : s.renewConfirm}>
        {newKey ? (
          <View style={{ gap: 12 }}>
            <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.renewBody}</Text>
            <RecoveryKeyCard recoveryKey={newKey} />
            <Button label={strings.start.savedIt} onPress={() => setSheet(null)} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.renewConfirmBody}</Text>
            <Button
              label={busy ? s.working : s.makeNewKey}
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  setNewKey(await renewRecoveryKey(backupDeps()));
                  void backupNow(backupDeps());
                })
              }
            />
            <Button label={strings.common.cancel} kind="secondary" onPress={() => setSheet(null)} />
          </View>
        )}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  h1: { fontFamily: fonts.serif, fontSize: 25, lineHeight: 30 },
  body: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
  tiny: { fontFamily: fonts.sans, fontSize: 10.5 },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  lbl: { fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.5 },
  driveCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  driveIcon: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  badge: { fontFamily: fonts.sansBold, fontSize: 10, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, overflow: 'hidden' },
  select: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: radius.field, paddingHorizontal: 13, paddingVertical: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
});
