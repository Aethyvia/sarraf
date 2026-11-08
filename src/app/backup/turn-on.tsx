import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text } from 'react-native';

import { RecoveryKeyCard } from '@/components/backup/RecoveryKeyCard';
import { Note, StartPage } from '@/components/start/StartPage';
import { Button, Card, Field, LinkButton } from '@/components/ui';
import { backupNow, getDeviceState, startBackupSetup } from '@/data/backup-flow';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { backupDeps, cloud } from '@/services/cloud';
import { DriveRefusedError, OfflineError } from '@/services/cloud/types';
import { goBack } from '@/state/nav';
import { useToast } from '@/state/toast';
import { fonts, useTheme } from '@/theme';

/** Turning backup on later from Settings: Drive, a backup password, then the recovery key (shown once). */
export default function TurnOnBackupScreen() {
  const s = strings.start;
  const { colors } = useTheme();
  const toast = useToast();
  const [password, setPassword] = useState(['', '']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drive, setDrive] = useState<string | null>(() => getDeviceState(db).driveEmail);
  const [key, setKey] = useState<string | null>(null);
  const finished = useRef<Promise<void> | null>(null);

  const turnOn = async () => {
    if (password[0].length < 8) return setError(s.passwordShort);
    if (password[0] !== password[1]) return setError(s.passwordMismatch);
    setBusy(true);
    try {
      if (!drive) setDrive((await cloud.connectDrive()).email);
      const started = startBackupSetup(backupDeps(), password[0]);
      finished.current = started.finished;
      setKey(started.recoveryKey);
    } catch (e) {
      toast({ message: e instanceof OfflineError ? s.offlineTitle : e instanceof DriveRefusedError ? s.refusedTitle : s.failed });
    } finally {
      setBusy(false);
    }
  };

  const done = async () => {
    setBusy(true);
    try {
      await finished.current;
      const r = await backupNow(backupDeps());
      toast({ message: r.ok ? strings.backup.backedUp : strings.backup.failed });
      router.back();
    } finally {
      setBusy(false);
    }
  };

  if (key) {
    return (
      <StartPage title={s.keyShownTitle} body={s.keyShownBody} footer={<Button label={busy ? s.working : s.savedIt} disabled={busy} onPress={() => void done()} />}>
        <RecoveryKeyCard recoveryKey={key} />
      </StartPage>
    );
  }

  return (
    <StartPage
      onBack={goBack}
      icon="cloud"
      title={strings.backup.turnOn}
      body={s.backupBody}
      footer={<Button label={busy ? s.working : s.turnOn} disabled={busy} onPress={() => void turnOn()} />}
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ flex: 1, fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.ink }}>{drive ?? s.connectDrive}</Text>
        {drive ? <LinkButton label={s.change} onPress={() => void cloud.connectDrive({ another: true }).then((d) => setDrive(d.email))} /> : null}
      </Card>
      <Field label={s.passwordLabel} value={password[0]} onChangeText={(v) => (setPassword([v, password[1]]), setError(null))} secureTextEntry autoCapitalize="none" placeholder={s.passwordHint} />
      <Field label={s.passwordAgain} value={password[1]} onChangeText={(v) => (setPassword([password[0], v]), setError(null))} secureTextEntry autoCapitalize="none" />
      {error ? <Note tone="red">{error}</Note> : null}
      <Note tone="amber" icon="key">
        {s.passwordMatters}
      </Note>
    </StartPage>
  );
}
