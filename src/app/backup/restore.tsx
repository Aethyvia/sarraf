import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Note, Spinner, StartPage } from '@/components/start/StartPage';
import { BottomSheet, Button, Field, LinkButton } from '@/components/ui';
import { addedSince, applyRestore } from '@/data/backup-flow';
import { openBackup, readBackupHeader, type BackupHeader } from '@/data/backup-file';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { isRecoveryKeyShape, WrongSecretError } from '@/lib/backup-crypto';
import { formatShortDate } from '@/lib/format-date';
import { backupDeps, cloud } from '@/services/cloud';
import { goBack } from '@/state/nav';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Restore from Settings (Restore confirm board; replace-only, Decided Nov 7):
 * find the backup, confirm what's replaced and what's lost, then the backup
 * password or recovery key. Nothing changes until the backup is open.
 */
export default function RestoreScreen() {
  const s = strings.backup;
  const st = strings.start;
  const { colors } = useTheme();
  const toast = useToast();
  const file = useRef<Uint8Array | null>(null);
  const [header, setHeader] = useState<BackupHeader | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [mode, setMode] = useState<'password' | 'key'>('password');
  const [secret, setSecret] = useState('');
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        await cloud.connectDrive();
        if (!(await cloud.findBackup())) return setMissing(true);
        file.current = await cloud.downloadBackup();
        setHeader(readBackupHeader(file.current).header);
      } catch (e) {
        toast({ message: (e as Error).message || s.failed });
        goBack();
      }
    })();
  }, [s.failed, toast]);

  const unlock = async () => {
    if (!file.current) return;
    setBusy(true);
    try {
      const opened = await openBackup(file.current, secret.trim());
      setRestoring(true);
      await applyRestore(backupDeps(), opened, file.current.length);
      toast({ message: s.restoredToast });
      router.dismissTo('/');
    } catch (e) {
      setRestoring(false);
      if (e instanceof WrongSecretError) setTries((n) => n + 1);
      else toast({ message: (e as Error).message || s.failed });
    } finally {
      setBusy(false);
    }
  };

  if (missing) return <StartPage onBack={goBack} icon="cloud" iconTone="neutral" title={st.noBackupTitle} body={s.noBackup} />;
  if (!header || restoring) {
    return (
      <StartPage centered title={restoring ? st.restoringTitle : st.looking} body={restoring ? st.restoringNote : undefined}>
        <Spinner icon="cloud" />
      </StartPage>
    );
  }

  const isKey = mode === 'key';
  const lost = addedSince(db, header.createdAt);
  return (
    <>
      <StartPage
        onBack={goBack}
        icon={isKey ? 'key' : 'lock'}
        title={isKey ? st.keyTitle : st.passwordTitle}
        body={isKey ? st.keyBody : st.passwordBody}
        footer={
          <>
            <Button label={busy ? st.unlocking : st.unlock} disabled={busy || !confirmed || !secret.trim() || (isKey && !isRecoveryKeyShape(secret))} onPress={() => void unlock()} />
            <LinkButton label={isKey ? st.usePassword : st.useRecovery} onPress={() => (setSecret(''), setTries(0), setMode(isKey ? 'password' : 'key'))} />
          </>
        }
      >
        <Field
          label={isKey ? 'Recovery key' : st.passwordField}
          value={secret}
          onChangeText={setSecret}
          secureTextEntry={!isKey}
          autoCapitalize={isKey ? 'characters' : 'none'}
          autoCorrect={false}
        />
        {tries > 0 ? <Note tone="red">{isKey ? st.wrongKey(Math.min(tries, 3)) : st.wrongPassword(Math.min(tries, 3))}</Note> : null}
        {tries >= 3 ? <Text style={[styles.small, { color: colors.inkMuted }]}>{st.cantNote}</Text> : null}
      </StartPage>
      <BottomSheet visible={!confirmed} onClose={goBack} title={s.confirmTitle}>
        <View style={{ gap: 14 }}>
          <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.confirmBody}</Text>
          <View style={[styles.box, { backgroundColor: colors.filled }]}>
            <View style={[styles.boxRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.backupFrom}</Text>
              <Text style={[styles.value, { color: colors.ink }]}>
                {formatShortDate(header.createdAt.slice(0, 10))}, {new Date(header.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
            <View style={[styles.boxRow, lost > 0 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.inBackup}</Text>
              <Text style={[styles.mono, { color: colors.ink }]}>{s.transactions(header.counts.transactions)}</Text>
            </View>
            {lost > 0 ? (
              <View style={styles.boxRow}>
                <Text style={[styles.body, { color: colors.expense }]}>{s.willBeLost}</Text>
                <Text style={[styles.mono, { color: colors.expense }]}>{s.newer(lost)}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.small, { color: colors.inkMuted }]}>{s.tip}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={strings.common.cancel} kind="secondary" style={{ flex: 1 }} onPress={goBack} />
            <Button label={s.replace} style={{ flex: 1, backgroundColor: colors.expense }} onPress={() => setConfirmed(true)} />
          </View>
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  small: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  value: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
  mono: { fontFamily: fonts.monoSemiBold, fontSize: 13 },
  box: { borderRadius: radius.field, paddingHorizontal: 14, paddingVertical: 6 },
  boxRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
});
