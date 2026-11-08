import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { Note } from '@/components/start/StartPage';
import { BottomSheet, Button, Field, LinkButton } from '@/components/ui';
import { checkPin, FREE_TRIES, proveWithBackupSecret, setPin, shouldLock, waitLeft, WAITS } from '@/data/app-lock';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { keyStore } from '@/services/cloud';
import { useSettings } from '@/state/settings';
import { fonts, useTheme } from '@/theme';
import { CreatePin } from './CreatePin';
import { PinDots, PinPad } from './PinPad';

function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m} min ${seconds % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * App lock (Spec §4): covers the app on open and after "Lock after" in the
 * background, until the PIN (or fingerprint) unlocks it. Also applies "Hide
 * in recent apps". Wrong tries never delete data.
 */
export function LockGate() {
  const s = strings.lock;
  const { colors } = useTheme();
  const set = useSettings();
  const [locked, setLocked] = useState(() => set.appLockEnabled && !!set.pinHash);
  const background = useRef<number | null>(null);
  const [pin, setPinText] = useState('');
  const [error, setError] = useState(false);
  const [triesLeft, setTriesLeft] = useState<number | null>(null);
  const [wait, setWait] = useState(() => waitLeft(db, new Date()));
  const [forgot, setForgot] = useState<'password' | 'key' | null>(null);
  const [secret, setSecret] = useState('');
  const [secretWrong, setSecretWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [hasBackupKeys, setHasBackupKeys] = useState(false);
  const [bioReady, setBioReady] = useState(false);

  useEffect(() => {
    void (set.hideInRecents ? ScreenCapture.preventScreenCaptureAsync('app-lock') : ScreenCapture.allowScreenCaptureAsync('app-lock')).catch(() => {});
  }, [set.hideInRecents]);

  useEffect(() => {
    void LocalAuthentication.hasHardwareAsync().then(async (hw) => setBioReady(hw && (await LocalAuthentication.isEnrolledAsync())));
    void keyStore.get().then((k) => setHasBackupKeys(!!k));
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') background.current = Date.now();
      if (state === 'active') {
        if (shouldLock(set.appLockEnabled && !!set.pinHash, set.lockAfterSeconds, background.current, Date.now())) setLocked(true);
        background.current = null;
      }
    });
    return () => sub.remove();
  }, [set.appLockEnabled, set.pinHash, set.lockAfterSeconds]);

  // Counts down a wait after too many wrong tries.
  useEffect(() => {
    if (!locked || wait <= 0) return;
    const t = setInterval(() => setWait(waitLeft(db, new Date())), 1000);
    return () => clearInterval(t);
  }, [locked, wait]);

  const unlock = useCallback(() => {
    setLocked(false);
    setPinText('');
    setError(false);
    setTriesLeft(null);
    setForgot(null);
    setResetting(false);
  }, []);

  const biometric = useCallback(async () => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: s.biometricPrompt, disableDeviceFallback: true, cancelLabel: strings.common.cancel });
    if (r.success) unlock();
  }, [s.biometricPrompt, unlock]);

  // Fingerprint is offered as soon as the lock shows.
  useEffect(() => {
    if (!(locked && set.biometricsEnabled && bioReady && wait === 0)) return;
    const t = setTimeout(() => void biometric(), 300);
    return () => clearTimeout(t);
  }, [locked, set.biometricsEnabled, bioReady, wait, biometric]);

  if (!locked || !set.appLockEnabled) return null;

  const digit = (d: string) => {
    const next = (error ? '' : pin) + d;
    setError(false);
    if (next.length < set.pinLength) return setPinText(next);
    const r = checkPin(db, next, new Date());
    setPinText('');
    if (r.ok) return unlock();
    setError(true);
    setTriesLeft(r.triesLeft);
    setWait(waitLeft(db, new Date()));
  };

  return (
    <Modal visible animationType="none" statusBarTranslucent onRequestClose={() => {}}>
      {resetting ? (
        <CreatePin
          title={s.newPinTitle}
          onDone={(p, length) => {
            setPin(db, p, length);
            unlock();
          }}
        />
      ) : (
        <SafeAreaView style={[styles.wrap, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
          <View style={{ alignItems: 'center', gap: 12 }}>
            <View style={[styles.logo, { backgroundColor: colors.accent }]}>
              <Icon name="lock" size={24} color={colors.onAccent} strokeWidth={2} />
            </View>
            <Text style={[styles.title, { color: colors.ink }]}>{s.locked}</Text>
            {error && wait === 0 ? <Text style={[styles.wrong, { color: colors.expense }]}>{s.wrong}</Text> : null}
          </View>
          <PinDots length={set.pinLength} filled={pin.length} error={error} />
          {wait > 0 ? (
            <Note tone="red">{s.waiting(waitText(wait))}</Note>
          ) : error && triesLeft !== null && triesLeft > 0 && triesLeft < FREE_TRIES ? (
            <Note tone="red">{s.triesLeft(triesLeft, WAITS[0])}</Note>
          ) : null}
          {error || wait > 0 ? <Text style={[styles.small, { color: colors.inkMuted }]}>{s.neverDeletes}</Text> : null}
          <View style={{ flex: 1 }} />
          <PinPad
            disabled={wait > 0}
            onDigit={digit}
            onDelete={() => setPinText((p) => p.slice(0, -1))}
            onBiometric={set.biometricsEnabled && bioReady ? () => void biometric() : undefined}
          />
          <LinkButton label={s.forgot} onPress={() => (setSecret(''), setSecretWrong(false), setForgot('password'))} />
        </SafeAreaView>
      )}
      <BottomSheet visible={forgot !== null && !resetting} onClose={() => setForgot(null)} title={s.resetTitle}>
        <View style={{ gap: 12 }}>
          {hasBackupKeys ? (
            <>
              <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.resetBody}</Text>
              <Field
                label={forgot === 'key' ? s.resetKeyField : s.resetField}
                value={secret}
                onChangeText={(v) => (setSecret(v), setSecretWrong(false))}
                secureTextEntry={forgot !== 'key'}
                autoCapitalize={forgot === 'key' ? 'characters' : 'none'}
                autoCorrect={false}
              />
              {secretWrong ? <Note tone="red">{s.resetWrong}</Note> : null}
              <Button
                label={busy ? strings.start.unlocking : strings.start.continue}
                disabled={busy || !secret.trim()}
                onPress={async () => {
                  setBusy(true);
                  const ok = await proveWithBackupSecret(keyStore, secret.trim());
                  setBusy(false);
                  if (ok) setResetting(true);
                  else setSecretWrong(true);
                }}
              />
              <LinkButton label={forgot === 'key' ? strings.start.usePassword : strings.start.useRecovery} onPress={() => (setSecret(''), setForgot(forgot === 'key' ? 'password' : 'key'))} />
            </>
          ) : null}
          <View style={[styles.box, { backgroundColor: colors.filled }]}>
            <Text style={[styles.boxTitle, { color: colors.ink }]}>{s.resetNoBackupTitle}</Text>
            <Text style={[styles.small, { color: colors.inkSecondary, textAlign: 'left' }]}>{s.resetNoBackup}</Text>
          </View>
        </View>
      </BottomSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 28, paddingTop: 56, paddingBottom: 20, gap: 12 },
  logo: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.serif, fontSize: 22 },
  wrong: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, textAlign: 'center' },
  box: { borderRadius: 12, padding: 12, gap: 2 },
  boxTitle: { fontFamily: fonts.sansBold, fontSize: 12.5 },
});
