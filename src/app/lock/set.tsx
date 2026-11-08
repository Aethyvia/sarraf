import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { CreatePin } from '@/components/lock/CreatePin';
import { Note, StartPage } from '@/components/start/StartPage';
import { Button, LinkButton } from '@/components/ui';
import { setPin } from '@/data/app-lock';
import { getDeviceState } from '@/data/backup-flow';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { goBack } from '@/state/nav';
import { useToast } from '@/state/toast';
import { eq } from 'drizzle-orm';

/**
 * Create or change the PIN. With backup off, a strong warning comes first
 * (Create PIN — backup is off board): a forgotten PIN then means erasing Sarraf.
 * `biometrics=1` also turns on fingerprint unlock (first-run offer).
 */
export default function SetPinScreen() {
  const s = strings.lock;
  const toast = useToast();
  const { change, biometrics } = useLocalSearchParams<{ change?: string; biometrics?: string }>();
  const backupOn = getDeviceState(db).backupEnabled;
  const [warned, setWarned] = useState(backupOn || change === '1');

  if (!warned) {
    return (
      <StartPage
        onBack={goBack}
        title={s.createTitle}
        body={s.createBody(4)}
        footer={
          <>
            <Button label={s.turnOnFirst} onPress={() => router.replace('/backup/turn-on')} />
            <LinkButton label={s.continueWithout} onPress={() => setWarned(true)} />
          </>
        }
      >
        <Note tone="red" icon="lock">
          {`${s.backupOffTitle}. ${s.backupOffBody}`}
        </Note>
      </StartPage>
    );
  }

  return (
    <CreatePin
      onClose={goBack}
      onDone={(pin, length) => {
        setPin(db, pin, length);
        if (biometrics === '1') db.update(settings).set({ biometricsEnabled: true }).where(eq(settings.id, 1)).run();
        toast({ message: change === '1' ? s.pinChanged : s.pinSet });
        goBack();
      }}
    />
  );
}
