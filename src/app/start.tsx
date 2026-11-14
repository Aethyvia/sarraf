import { getLocales } from 'expo-localization';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecoveryKeyCard } from '@/components/backup/RecoveryKeyCard';
import { BackupProgressCard } from '@/components/backup/BackupProgressCard';
import { ProgressBar } from '@/components/ProgressBar';
import { Icon } from '@/components/icons/Icon';
import { parts } from '@/components/parts';
import { SignInSheet } from '@/components/start/SignInSheet';
import { AccountsStep, CurrencyStep } from '@/components/start/SetupSteps';
import { Note, Spinner, StartPage } from '@/components/start/StartPage';
import { BottomSheet, Button, Card, Field, LinkButton, ToggleRow } from '@/components/ui';
import { WrongSecretError, isRecoveryKeyShape, normalizeRecoveryKey } from '@/lib/backup-crypto';
import { type BackupProgress, applyRestore, backupNow, currentUser, detachPreviousBackup, getDeviceState, lookInDrive, makeThisTheBackupPhone, rememberSignIn, startBackupSetup } from '@/data/backup-flow';
import { backupCounts, openBackup, type BackupCounts, type BackupHeader } from '@/data/backup-file';
import { decideAfterSignIn, isAccountSwitch } from '@/data/sign-in';
import { FREE_LIMITS, usage } from '@/data/limits';
import { finishSetup, suggestedAccounts, type SuggestedAccount } from '@/data/setup';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { isCurrencyCode } from '@/lib/money';
import { backupDeps, cloud, usingRealCloud } from '@/services/cloud';
import { BadCodeError, CancelledError, DriveRefusedError, OfflineError, type CloudUser } from '@/services/cloud/types';
import { store } from '@/services/store';
import { askForNotificationsAfterSignIn } from '@/services/notifications';
import { refreshPlan } from '@/data/plan';
import { clearSignedOut, isSignedOut, wipeLocalData } from '@/data/sarraf-account';
import { deleteAllStoredFiles } from '@/services/attachments';
import { settings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { usePlan } from '@/state/plan';
import { useToast } from '@/state/toast';
import { backupProblem, restoreProblem } from '@/data/backup-errors';
import { fonts, useTheme } from '@/theme';

/** What "We found your backup" shows: from the Supabase record or the Drive file's header. */
interface Found {
  driveEmail: string;
  /** The phone that made it (this phone's own backup needs no "moves" warning). */
  deviceId?: string;
  deviceName: string;
  at: string;
  counts: BackupCounts;
}

type Step =
  | { k: 'welcome' }
  | { k: 'email' }
  | { k: 'code'; email: string }
  | { k: 'offline'; retry: () => void }
  | { k: 'hasData'; found: Found | null; switched: boolean }
  | { k: 'driveHas'; found: Found }
  | { k: 'finding'; another?: boolean; forNew?: boolean }
  | { k: 'noBackup'; driveEmail: string }
  | { k: 'refused'; forNew: boolean }
  | { k: 'found'; found: Found }
  | { k: 'secret'; mode: 'password' | 'key' }
  | { k: 'cant' }
  | { k: 'restoring' }
  | { k: 'interrupted'; pct: number | null; problem?: string }
  | { k: 'over'; header: BackupHeader }
  | { k: 'restored'; header: BackupHeader }
  | { k: 'currency' }
  | { k: 'accounts' }
  | { k: 'backup' }
  | { k: 'key' }
  | { k: 'check' }
  | { k: 'pin' }
  | { k: 'done' };

function regionCurrency(): string {
  const c = getLocales()[0]?.currencyCode;
  return c && isCurrencyCode(c) ? c : 'USD';
}

/**
 * First run (Decided Nov 7, council review): sign in first, then either the
 * backup that sign-in found (restore) or a 4-step setup. One screen with its
 * own steps, so passwords and keys never travel through links.
 */
export default function StartScreen() {
  const s = strings.start;
  const { colors } = useTheme();
  const toast = useToast();
  const plan = usePlan();
  const [history, setHistory] = useState<Step[]>([{ k: 'welcome' }]);
  const step = history[history.length - 1];
  const go = (next: Step) => setHistory((h) => [...h, next]);
  const replace = (next: Step) => setHistory((h) => [...h.slice(0, -1), next]);
  const back = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));

  const [sheet, setSheet] = useState<'new' | 'returning' | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [user, setUser] = useState<CloudUser | null>(() => currentUser(db));

  const [secret, setSecret] = useState('');
  const [tries, setTries] = useState(0);
  const [progress, setProgress] = useState<{ step: string; pct: number; done?: number; total?: number }>({ step: 'download', pct: 0 });
  const file = useRef<Uint8Array | null>(null);
  const downloaded = useRef(0);

  const [everyday, setEveryday] = useState(regionCurrency);
  const [also, setAlso] = useState<string[]>(() => (regionCurrency() === 'USD' ? [] : ['USD']));
  const [items, setItems] = useState<SuggestedAccount[]>([]);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [skipSheet, setSkipSheet] = useState(false);
  const [freshSheet, setFreshSheet] = useState(false);
  const [overSheet, setOverSheet] = useState(false);
  const [keepSheet, setKeepSheet] = useState(false);
  const [eraseText, setEraseText] = useState('');
  // Asked for "I already use Sarraf": with nothing on record, look in Drive rather than start setup.
  const returning = useRef(false);
  // The user chose to replace the backup in Drive (Start fresh, Replace it, Keep): the first backup may.
  const replaceOk = useRef(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const keysReady = useRef<Promise<void> | null>(null);
  const [checkGroups] = useState(() => {
    const a = 1 + Math.floor(Math.random() * 3);
    return [a, a + 2 + Math.floor(Math.random() * (5 - a))] as const;
  });
  const [check, setCheck] = useState(['', '']);
  const [checkError, setCheckError] = useState(false);
  const [driveEmail, setDriveEmail] = useState<string | null>(() => getDeviceState(db).driveEmail);
  const [accountCount, setAccountCount] = useState(0);
  const [offerBio, setOfferBio] = useState(true);
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null);
  // Setup already done here (a guest opening Sign in from Settings): no "Continue as guest".
  const onboarded = !!db.select({ o: settings.onboardingCompletedAt }).from(settings).get()?.o;

  // Still signed in on an emptied phone (Delete → this phone's data): carry on from sign-in, no Welcome.
  useEffect(() => {
    const u = currentUser(db);
    const hasData = !!db.select({ o: settings.onboardingCompletedAt }).from(settings).get()?.o;
    if (u && !hasData && !isSignedOut(db)) void online(() => afterSignIn(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android back walks back through the steps; nothing to go back to past Welcome.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (['restoring', 'done', 'restored', 'over'].includes(step.k)) return true;
      if (history.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  });

  /** Runs an online step; offline shows "You're offline" with Try again. */
  const online = async (work: () => Promise<void>, onRefused?: () => void) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      if (e instanceof OfflineError) go({ k: 'offline', retry: () => void online(work, onRefused) });
      else if (e instanceof DriveRefusedError && onRefused) onRefused();
      else if (!(e instanceof CancelledError)) toast({ message: (e as Error).message || s.failed });
    } finally {
      setBusy(false);
    }
  };

  /**
   * After sign-in (council, Nov 12): check, then ask only about a real conflict.
   * Who this phone's data belonged to is read BEFORE recording the new sign-in,
   * so a different account never quietly takes over this phone's data.
   */
  const afterSignIn = async (u: CloudUser) => {
    const prevUserId = getDeviceState(db).userId ?? getDeviceState(db).signedOutUserId ?? null;
    const hasData = !!db.select({ o: settings.onboardingCompletedAt }).from(settings).get()?.o;
    const thisDeviceId = db.select({ id: settings.deviceId }).from(settings).where(eq(settings.id, 1)).get()!.id;
    const record = await cloud.getRecord(u);
    rememberSignIn(db, u);
    setUser(u);
    setSheet(null);
    // The plan is known before anything asks about limits (after the sequence, on Home).
    await refreshPlan(db, cloud, u, new Date()).catch(() => {});
    const found = record ? { driveEmail: record.driveEmail, deviceId: record.deviceId, deviceName: record.deviceName, at: record.lastBackupAt, counts: record.counts } : null;
    switch (decideAfterSignIn({ hasData, prevUserId, userId: u.id, record, thisDeviceId })) {
      case 'home':
        clearSignedOut(db);
        void askForNotificationsAfterSignIn();
        router.replace('/');
        return;
      case 'hasData':
        return go({ k: 'hasData', found, switched: isAccountSwitch({ prevUserId, userId: u.id }) });
      case 'found':
        return go({ k: 'found', found: found! });
      case 'setup':
        // "I already use Sarraf" with nothing on record: look in Drive (they may have signed in another way).
        return returning.current ? look({ forNew: true }) : startSetup();
    }
  };

  /** Keep this phone's data under this account (council, Nov 12). */
  const keepData = (f: Found | null, switched: boolean) =>
    online(async () => {
      if (switched) await detachPreviousBackup(backupDeps());
      clearSignedOut(db);
      setKeepSheet(false);
      void askForNotificationsAfterSignIn();
      // The user confirmed replacing the backup in Drive.
      const on = getDeviceState(db).backupEnabled;
      if (f && on) void makeThisTheBackupPhone(backupDeps()).catch(() => {});
      router.replace(on ? '/' : { pathname: '/backup/turn-on', params: f ? { replace: '1' } : {} });
    });

  const pickSignIn = (method: 'google' | 'github' | 'email') => {
    if (!cloud.ready) return toast({ message: s.notReady });
    if (method === 'email') {
      setSheet(null);
      return go({ k: 'email' });
    }
    void online(async () => afterSignIn(await cloud.signIn(method)));
  };

  const look = (options: { another?: boolean; forNew: boolean }) => {
    go({ k: 'finding', another: options.another, forNew: options.forNew });
    void online(
      async () => {
        const r = await lookInDrive(backupDeps(), { another: options.another });
        setDriveEmail(r.driveEmail);
        if (r.header) replace({ k: 'found', found: { driveEmail: r.driveEmail, deviceId: r.header.deviceId, deviceName: r.header.deviceName, at: r.header.createdAt, counts: r.header.counts } });
        else replace({ k: 'noBackup', driveEmail: r.driveEmail });
      },
      () => replace({ k: 'refused', forNew: options.forNew }),
    );
  };

  /** Start over (Owner, Nov 12): erase this phone's data, stay signed in, set up as new. */
  const startOver = () => {
    const u = user;
    deleteAllStoredFiles();
    wipeLocalData(db);
    if (u) rememberSignIn(db, u);
    setOverSheet(false);
    setEraseText('');
    replaceOk.current = true;
    setHistory([{ k: 'welcome' }]);
    startSetup();
  };

  const startSetup = () => {
    setItems(suggestedAccounts(everyday, also));
    go({ k: 'currency' });
  };

  const unlock = () =>
    online(async () => {
      try {
        if (!file.current) {
          downloaded.current = 0;
          setProgress({ step: 'download', pct: 0 });
          await cloud.connectDrive();
          file.current = await cloud.downloadBackup((done, total) => {
            downloaded.current = total ? Math.round((done / total) * 100) : 0;
            setProgress({ step: 'download', pct: downloaded.current });
          });
        }
        // The password is checked here ("Unlocking…"); only then does anything on the phone change.
        const opened = await openBackup(file.current, secret.trim());
        go({ k: 'restoring' });
        const header = await applyRestore(backupDeps(), opened, file.current.length, (st, done, total) =>
          setProgress({ step: st, pct: total ? Math.round((done / total) * 100) : 0, done, total }),
        );
        const over = plan === 'free' && usage(db, 'accounts') > FREE_LIMITS.accounts;
        setHistory([{ k: 'welcome' }, over ? { k: 'over', header } : { k: 'restored', header }]);
        void askForNotificationsAfterSignIn();
      } catch (e) {
        if (e instanceof WrongSecretError) {
          const n = tries + 1;
          setTries(n);
          if (n >= 3) {
            setTries(0);
            go({ k: 'cant' });
          }
        } else if (e instanceof OfflineError) {
          file.current = null;
          go({ k: 'interrupted', pct: downloaded.current || null });
        } else {
          go({ k: 'interrupted', pct: null, problem: restoreProblem(e) });
        }
      }
    });

  const turnOnBackup = () => {
    if (password.length < 8) return setPwError(s.passwordShort);
    if (password !== password2) return setPwError(s.passwordMismatch);
    setPwError(null);
    void online(
      async () => {
        // The Drive is the truth (council, Nov 12): a backup there that this
        // phone didn't make (another sign-in, say) is never silently replaced.
        const look = await lookInDrive(backupDeps());
        setDriveEmail(look.driveEmail);
        const thisDeviceId = db.select({ id: settings.deviceId }).from(settings).where(eq(settings.id, 1)).get()!.id;
        if (look.header && look.header.deviceId !== thisDeviceId && !replaceOk.current) {
          go({ k: 'driveHas', found: { driveEmail: look.driveEmail, deviceName: look.header.deviceName, at: look.header.createdAt, counts: look.header.counts } });
          return;
        }
        const started = startBackupSetup(backupDeps(), password);
        keysReady.current = started.finished;
        setRecoveryKey(started.recoveryKey);
        go({ k: 'key' });
      },
      () => go({ k: 'refused', forNew: true }),
    );
  };

  const complete = (withBackup: boolean, thenPin = false) =>
    online(async () => {
      if (withBackup && keysReady.current) await keysReady.current;
      const picked = items.filter((a) => a.ticked);
      finishSetup(db, { everyday, also, accounts: picked }, plan);
      setAccountCount(picked.length);
      setRecoveryKey(null);
      setPassword('');
      setPassword2('');
      setHistory([{ k: 'done' }]);
      void askForNotificationsAfterSignIn();
      if (withBackup) {
        setBackupProgress({ step: 'check', fraction: 0 });
        backupNow(backupDeps(), { replaceExisting: replaceOk.current, onProgress: setBackupProgress })
          .then((r) => (r.ok ? undefined : toast({ message: backupProblem(r) })))
          .catch((e) => toast({ message: backupProblem(e) }));
      }
      if (thenPin) router.push({ pathname: '/lock/set', params: offerBio ? { biometrics: '1' } : {} });
    });

  const methodName = s.methods[user?.method ?? 'dev'];
  const groups = recoveryKey?.split('-') ?? [];

  switch (step.k) {
    case 'welcome':
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
          <View style={styles.welcome}>
            <View style={styles.welcomeMain}>
              <View style={{ alignItems: 'center', gap: 14 }}>
                <View style={[styles.logo, { backgroundColor: colors.accent }]}>
                  <Icon name="dollar" size={27} color={colors.onAccent} strokeWidth={1.8} />
                </View>
                <Text style={[styles.brand, { color: colors.ink }]}>Sarraf</Text>
                <Text style={[styles.welcomeTitle, { color: colors.ink }]}>{s.welcomeTitle}</Text>
                <Text style={[styles.welcomeBody, { color: colors.inkSecondary }]}>{s.welcomeBody}</Text>
              </View>
              <Card style={styles.example}>
                <View style={styles.exampleTop}>
                  <Text style={[styles.lbl, { color: colors.inkMuted }]}>{s.exampleRoute}</Text>
                  <Text style={[styles.exampleTag, { color: colors.warning, backgroundColor: colors.warningSoft }]}>{s.example}</Text>
                </View>
                <View style={styles.exampleTop}>
                  <Text style={[styles.mono, { color: colors.inkMuted, fontSize: 13 }]}>{s.exampleSent}</Text>
                  <Text style={[styles.mono, { color: colors.ink, fontSize: 16, fontFamily: fonts.monoSemiBold }]}>{s.exampleGot}</Text>
                </View>
                <Text style={[styles.small, { color: colors.inkSecondary }]}>{s.exampleRate}</Text>
              </Card>
            </View>
            <View style={styles.staysRow}>
              <Icon name="lock" size={12} color={colors.inkMuted} strokeWidth={2} />
              <Text style={[styles.small, { color: colors.inkMuted }]}>{s.stays}</Text>
            </View>
            <Button label={s.getStarted} onPress={() => ((returning.current = false), setSheet('new'))} />
            <Button label={s.alreadyUse} kind="secondary" onPress={() => ((returning.current = true), setSheet('returning'))} />
            {/* Guest (owner, Nov 14): everything on the phone, free plan; backup and Plus wait for a Sarraf account. */}
            {!onboarded ? <LinkButton label={s.guest} onPress={startSetup} /> : null}
            {!onboarded ? <Text style={[styles.small, { color: colors.inkMuted, textAlign: 'center', marginTop: -6 }]}>{s.guestNote}</Text> : null}
          </View>
          <SignInSheet
            mode={sheet}
            busy={busy}
            onClose={() => setSheet(null)}
            onPick={pickSignIn}
            onLegal={(doc) => {
              setSheet(null);
              router.push({ pathname: '/legal/[doc]', params: { doc } });
            }}
          />
        </SafeAreaView>
      );

    case 'email':
      return (
        <StartPage
          onBack={back}
          icon="mail"
          title={s.emailTitle}
          body={s.emailBody}
          footer={
            <Button
              label={busy ? s.working : s.sendCode}
              disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}
              onPress={() =>
                void online(async () => {
                  await cloud.sendEmailCode(email.trim());
                  setCode('');
                  setCodeError(false);
                  go({ k: 'code', email: email.trim() });
                })
              }
            />
          }
        >
          <Field label={s.emailField} value={email} onChangeText={setEmail} autoFocus keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        </StartPage>
      );

    case 'code':
      return (
        <StartPage
          onBack={back}
          icon="mail"
          title={s.codeTitle}
          body={parts(s.codeBody(<Text key="e" style={{ color: colors.ink, fontFamily: fonts.sansBold }}>{step.email}</Text>))}
          footer={
            <>
              <Button
                label={busy ? s.working : s.continue}
                disabled={busy || code.length !== 6}
                onPress={() =>
                  void online(async () => {
                    try {
                      await afterSignIn(await cloud.verifyEmailCode(step.email, code));
                    } catch (e) {
                      if (e instanceof BadCodeError) setCodeError(true);
                      else throw e;
                    }
                  })
                }
              />
              <LinkButton label={s.newCode} onPress={() => void online(async () => (await cloud.sendEmailCode(step.email), toast({ message: s.newCodeSent })))} />
              <Text style={[styles.small, { color: colors.inkMuted, textAlign: 'center' }]}>
                {s.wrongAddress}
                <Text style={{ color: colors.accent, fontFamily: fonts.sansBold }} onPress={back}>
                  {s.changeIt}
                </Text>
              </Text>
            </>
          }
        >
          <Field
            label="Code"
            value={code}
            onChangeText={(v) => {
              setCode(v.replace(/\D/g, '').slice(0, 6));
              setCodeError(false);
            }}
            autoFocus
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            style={styles.codeInput}
          />
          {codeError ? <Note tone="red">{s.codeWrong}</Note> : null}
          {__DEV__ && !usingRealCloud ? <Text style={[styles.small, { color: colors.inkMuted }]}>{s.devCode}</Text> : null}
        </StartPage>
      );

    case 'offline':
      return <StartPage onBack={back} icon="cloud" iconTone="neutral" title={s.offlineTitle} body={s.offlineBody} footer={<Button label={s.tryAgain} onPress={() => (back(), step.retry())} />} />;

    case 'hasData': {
      const f = step.found;
      const mine = backupCounts(db);
      const countRows = (c: BackupCounts, extra?: string) => (
        <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoValue, { color: colors.ink }]}>{s.insideCounts(c.accounts, c.ledgers, c.transactions)}</Text>
          </View>
          {extra ? (
            <View style={[styles.infoRow, { borderTopWidth: 1, borderTopColor: colors.line }]}>
              <Text style={[styles.small, { color: colors.inkMuted }]}>{extra}</Text>
            </View>
          ) : null}
        </Card>
      );
      const what = s.insideCounts(mine.accounts, mine.ledgers, mine.transactions);
      const typed = eraseText.trim().toUpperCase() === s.startOverWord;
      return (
        <StartPage
          icon={f ? 'cloud' : 'phone'}
          title={f ? s.hasDataBackupTitle : s.hasDataTitle}
          body={f ? s.hasDataBackupBody(f.driveEmail) : step.switched ? s.hasDataSwitchedBody : s.hasDataBody}
          footer={
            <>
              <Button label={step.switched ? s.keepThisPhoneSwitched : s.keepThisPhone} onPress={() => (f ? setKeepSheet(true) : void keepData(null, step.switched))} />
              {f ? (
                <Button
                  label={s.restoreBackupInstead}
                  kind="secondary"
                  onPress={() => {
                    setSecret('');
                    setTries(0);
                    go({ k: 'secret', mode: 'password' });
                  }}
                />
              ) : null}
              <LinkButton danger label={s.startOver} onPress={() => (setEraseText(''), setOverSheet(true))} />
            </>
          }
        >
          <Text style={[styles.small, { color: colors.inkMuted, fontFamily: fonts.sansBold, letterSpacing: 0.6 }]}>{s.onThisPhone}</Text>
          {countRows(mine)}
          {f ? (
            <>
              <Text style={[styles.small, { color: colors.inkMuted, fontFamily: fonts.sansBold, letterSpacing: 0.6 }]}>{s.inYourBackup}</Text>
              {countRows(f.counts, `${f.deviceName} · ${formatShortDate(f.at.slice(0, 10))}, ${f.at.slice(0, 4)}`)}
            </>
          ) : (
            <Note tone="teal">{step.switched ? s.keepNoteSwitched : s.keepNoteNoBackup}</Note>
          )}
          <BottomSheet visible={keepSheet} onClose={() => setKeepSheet(false)} title={s.keepTitle}>
            <View style={{ gap: 12 }}>
              <Text style={[styles.small, { color: colors.inkSecondary, fontSize: 13, lineHeight: 19 }]}>
                {f ? s.keepBody(f.deviceName, `${formatShortDate(f.at.slice(0, 10))}, ${f.at.slice(0, 4)}`) : ''}
              </Text>
              <Button label={s.goBack} onPress={() => setKeepSheet(false)} />
              <Button label={busy ? s.working : s.keepConfirm} kind="secondary" disabled={busy} onPress={() => void keepData(f, step.switched)} />
            </View>
          </BottomSheet>
          <BottomSheet visible={overSheet} onClose={() => setOverSheet(false)} title={s.startOverTitle}>
            <View style={{ gap: 12 }}>
              <Text style={[styles.small, { color: colors.inkSecondary, fontSize: 13, lineHeight: 19 }]}>{f ? s.startOverBodyBackup(what) : s.startOverBody(what)}</Text>
              {!f && !getDeviceState(db).lastBackupAt ? <Note tone="red">{s.startOverNoBackup}</Note> : null}
              <Field label={s.startOverType} value={eraseText} onChangeText={setEraseText} autoCapitalize="characters" placeholder={s.startOverWord} />
              <Button label={s.goBack} onPress={() => setOverSheet(false)} />
              <Button label={s.startOverConfirm} kind="danger" disabled={!typed} onPress={startOver} />
            </View>
          </BottomSheet>
        </StartPage>
      );
    }

    case 'driveHas':
      return (
        <StartPage
          onBack={back}
          icon="cloud"
          iconTone="warning"
          title={s.driveHasTitle}
          body={s.driveHasBody(step.found.driveEmail)}
          footer={
            <>
              <Button
                label={s.restoreIt}
                onPress={() => {
                  setSecret('');
                  setTries(0);
                  go({ k: 'secret', mode: 'password' });
                }}
              />
              <Button
                label={s.replaceIt}
                kind="secondary"
                onPress={() => {
                  replaceOk.current = true;
                  back();
                  turnOnBackup();
                }}
              />
              <LinkButton
                label={s.useAnotherDrive}
                onPress={() =>
                  void online(async () => {
                    setDriveEmail((await cloud.connectDrive({ another: true })).email);
                    back();
                  })
                }
              />
            </>
          }
        >
          <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
            {[
              [s.from, step.found.deviceName],
              [s.lastBackedUp, `${formatShortDate(step.found.at.slice(0, 10))}, ${step.found.at.slice(0, 4)}`],
              [s.inside, s.insideCounts(step.found.counts.accounts, step.found.counts.ledgers, step.found.counts.transactions)],
            ].map(([label, value], i) => (
              <View key={label} style={[styles.infoRow, i < 2 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
                <Text style={[styles.small, { color: colors.inkMuted, width: 92 }]}>{label}</Text>
                <Text style={[styles.infoValue, { color: colors.ink }]}>{value}</Text>
              </View>
            ))}
          </Card>
          <Note tone="amber">{s.replaceWarn}</Note>
        </StartPage>
      );

    case 'finding':
      return (
        <StartPage centered title={s.looking} body={driveEmail && !step.another ? s.lookingIn(driveEmail) : s.lookingDrive}>
          <Spinner icon="cloud" />
        </StartPage>
      );

    case 'noBackup':
      return (
        <StartPage
          onBack={back}
          icon="cloud"
          iconTone="neutral"
          title={s.noBackupTitle}
          body={s.noBackupBody(step.driveEmail)}
          footer={
            <>
              <Button label={s.tryAnother} onPress={() => (back(), look({ another: true, forNew: true }))} />
              <Button label={s.startFresh} kind="secondary" onPress={startSetup} />
            </>
          }
        >
          <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.noBackupHint}</Text>
        </StartPage>
      );

    case 'refused':
      return (
        <StartPage
          onBack={back}
          icon="cloud"
          iconTone="warning"
          title={s.refusedTitle}
          body={s.refusedBody}
          footer={
            <>
              <Button label={s.allowDrive} onPress={() => (back(), step.forNew && history.some((h) => h.k === 'backup') ? turnOnBackup() : look({ forNew: step.forNew }))} />
              <Button label={s.differentAccount} kind="secondary" onPress={() => (back(), look({ another: true, forNew: step.forNew }))} />
              {step.forNew ? (
                <>
                  <LinkButton label={s.skipForNow} onPress={() => (history.some((h) => h.k === 'backup') ? (back(), setSkipSheet(true)) : startSetup())} />
                  <Text style={[styles.small, { color: colors.inkMuted, textAlign: 'center' }]}>{s.skipNote}</Text>
                </>
              ) : null}
            </>
          }
        />
      );

    case 'found':
      return (
        <StartPage
          onBack={back}
          icon="check"
          title={s.foundTitle}
          body={s.foundOn(step.found.driveEmail)}
          footer={
            <>
              <Button
                label={s.restore}
                onPress={() => {
                  setSecret('');
                  setTries(0);
                  go({ k: 'secret', mode: 'password' });
                }}
              />
              <LinkButton label={s.startFreshInstead} onPress={() => setFreshSheet(true)} />
            </>
          }
        >
          <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
            {[
              [s.from, step.found.deviceName],
              [s.lastBackedUp, `${formatShortDate(step.found.at.slice(0, 10))}, ${step.found.at.slice(0, 4)} · ${new Date(step.found.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`],
              [s.inside, s.insideCounts(step.found.counts.accounts, step.found.counts.ledgers, step.found.counts.transactions)],
            ].map(([label, value], i) => (
              <View key={label} style={[styles.infoRow, i < 2 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
                <Text style={[styles.small, { color: colors.inkMuted, width: 92 }]}>{label}</Text>
                <Text style={[styles.infoValue, { color: colors.ink }]}>{value}</Text>
              </View>
            ))}
          </Card>
          {step.found.deviceId !== db.select({ id: settings.deviceId }).from(settings).where(eq(settings.id, 1)).get()?.id ? (
            <Note tone="amber" icon="phone">
              {s.movesWarning(step.found.deviceName)}
            </Note>
          ) : null}
          <BottomSheet visible={freshSheet} onClose={() => setFreshSheet(false)} title={s.freshTitle}>
            <View style={{ gap: 12 }}>
              <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.freshBody}</Text>
              <Note tone="amber">{s.freshWarn}</Note>
              <Button label={s.goBack} onPress={() => setFreshSheet(false)} />
              <Button
                label={s.startFresh}
                kind="secondary"
                onPress={() => {
                  setFreshSheet(false);
                  replaceOk.current = true;
                  startSetup();
                }}
              />
            </View>
          </BottomSheet>
        </StartPage>
      );

    case 'secret': {
      const isKey = step.mode === 'key';
      return (
        <StartPage
          onBack={back}
          icon={isKey ? 'key' : 'lock'}
          title={isKey ? s.keyTitle : s.passwordTitle}
          body={isKey ? s.keyBody : s.passwordBody}
          footer={
            <>
              <Button label={busy ? s.unlocking : s.unlock} disabled={busy || !secret.trim() || (isKey && !isRecoveryKeyShape(secret))} onPress={() => void unlock()} />
              <LinkButton label={isKey ? s.usePassword : s.useRecovery} onPress={() => (setSecret(''), replace({ k: 'secret', mode: isKey ? 'password' : 'key' }))} />
            </>
          }
        >
          <Field
            label={isKey ? 'Recovery key' : s.passwordField}
            value={secret}
            onChangeText={setSecret}
            autoFocus
            secureTextEntry={!isKey}
            autoCapitalize={isKey ? 'characters' : 'none'}
            autoCorrect={false}
            style={isKey ? styles.keyInput : undefined}
          />
          {tries > 0 ? <Note tone="red">{isKey ? s.wrongKey(tries) : s.wrongPassword(tries)}</Note> : null}
        </StartPage>
      );
    }

    case 'cant':
      return (
        <StartPage
          onBack={back}
          icon="lock"
          iconTone="warning"
          title={s.cantTitle}
          body={s.cantBody}
          footer={
            <>
              <Button label={s.tryAgain} onPress={() => (setSecret(''), replace({ k: 'secret', mode: 'password' }))} />
              <Button label={s.useRecoveryKey} kind="secondary" onPress={() => (setSecret(''), replace({ k: 'secret', mode: 'key' }))} />
              {history.some((h) => h.k === 'hasData') ? (
                <LinkButton label={s.backToChoices} onPress={() => setHistory((h) => h.slice(0, h.findIndex((x) => x.k === 'hasData') + 1))} />
              ) : (
                <LinkButton label={s.startFresh} onPress={() => setFreshSheet(true)} />
              )}
            </>
          }
        >
          <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.cantNote}</Text>
          <BottomSheet visible={freshSheet} onClose={() => setFreshSheet(false)} title={s.freshTitle}>
            <View style={{ gap: 12 }}>
              <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.freshBody}</Text>
              <Button label={s.goBack} onPress={() => setFreshSheet(false)} />
              <Note tone="amber">{s.freshWarn}</Note>
              <Button label={s.startFresh} kind="secondary" onPress={() => (setFreshSheet(false), (replaceOk.current = true), startSetup())} />
            </View>
          </BottomSheet>
        </StartPage>
      );

    case 'restoring':
      return (
        <StartPage centered title={s.restoringTitle}>
          <Spinner icon="cloud" />
          <ProgressBar
            value={(progress.step === 'download' ? Math.max(5, progress.pct * 0.5) : progress.step === 'open' ? 60 : progress.step === 'attachments' ? 70 + progress.pct * 0.3 : 70) / 100}
          />
          <Text style={[styles.small, { color: colors.inkSecondary, textAlign: 'center' }]}>
            {progress.step === 'attachments' && progress.total ? s.attachmentsOf(progress.done ?? 0, progress.total) : s.restoringSteps[progress.step]}
          </Text>
          <Text style={[styles.small, { color: colors.inkMuted, textAlign: 'center' }]}>{s.restoringNote}</Text>
        </StartPage>
      );

    case 'interrupted':
      return (
        <StartPage
          icon="cloud"
          iconTone="warning"
          title={s.interruptedTitle}
          body={s.interruptedBody(step.pct, step.problem ?? null)}
          footer={
            <>
              <Button label={s.tryAgain} onPress={() => (file.current = null, replace({ k: 'secret', mode: 'password' }))} />
              <Button label={s.startFresh} kind="secondary" onPress={startSetup} />
            </>
          }
        />
      );

    case 'over':
      return (
        <StartPage
          icon="star"
          iconTone="warning"
          title={s.overTitle(usage(db, 'accounts'))}
          body={s.overBody(FREE_LIMITS.accounts)}
          footer={
            <>
              <Button label={s.upgrade} onPress={() => (replace({ k: 'restored', header: step.header }), router.push('/plans'))} />
              <Button
                label={s.restorePurchase}
                kind="secondary"
                onPress={async () => {
                  const plus = await store.restore();
                  toast({ message: plus ? strings.plans.restored : strings.plans.nothingToRestore });
                  if (plus) replace({ k: 'restored', header: step.header });
                }}
              />
              <LinkButton label={s.continueFree} onPress={() => replace({ k: 'restored', header: step.header })} />
            </>
          }
        >
          <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
            {(
              [
                [s.accountsOf, usage(db, 'accounts'), FREE_LIMITS.accounts],
                [s.ledgersOf, usage(db, 'ledgers'), FREE_LIMITS.ledgers],
              ] as const
            ).map(([label, n, limit], i) => (
              <View key={label} style={[styles.infoRow, i === 0 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
                <Text style={[styles.body, { color: colors.inkSecondary, flex: 1 }]}>{label}</Text>
                <Text style={[styles.mono, { color: n > limit ? colors.warning : colors.ink }]}>{s.ofLimit(n, limit)}</Text>
              </View>
            ))}
          </Card>
        </StartPage>
      );

    case 'restored': {
      const c = step.header.counts;
      return (
        <StartPage
          centered
          icon="check"
          title={s.restoredTitle}
          body={s.restoredBody(s.restoredCounts(c.accounts, c.ledgers, c.transactions), formatShortDate(step.header.createdAt.slice(0, 10)))}
          footer={
            <>
              <Button label={s.setPin} onPress={() => (router.replace('/'), router.push('/lock/set'))} />
              <Button label={s.goHome} kind="secondary" onPress={() => router.replace('/')} />
            </>
          }
        >
          <Note tone="teal" icon="lock">
            {s.pinNudge}
          </Note>
        </StartPage>
      );
    }

    case 'currency':
      return (
        <CurrencyStep
          everyday={everyday}
          also={also}
          onChange={(e, a) => {
            setEveryday(e);
            setAlso(a);
          }}
          onBack={back}
          onNext={() => {
            setItems(suggestedAccounts(everyday, also));
            go({ k: 'accounts' });
          }}
          // A returning user whose backup isn't on record can still look for it.
          extra={user ? <LinkButton label={s.restoreFromDrive} onPress={() => look({ forNew: true })} /> : null}
        />
      );

    case 'accounts':
      // A guest has no Sarraf account to back up to: straight on to the PIN.
      return <AccountsStep items={items} everyday={everyday} onChange={setItems} onBack={back} onNext={() => go({ k: user ? 'backup' : 'pin' })} />;

    case 'backup': {
      const n = items.filter((a) => a.ticked).length;
      return (
        <StartPage
          onBack={back}
          step={3}
          title={s.backupTitle(n)}
          body={s.backupBody}
          footer={
            <>
              <Button label={busy ? s.working : s.turnOn} disabled={busy} onPress={turnOnBackup} />
              <LinkButton label={s.notNow} onPress={() => setSkipSheet(true)} />
            </>
          }
        >
          <Card
            style={[styles.userCard, !driveEmail && { borderWidth: 1.5, borderColor: colors.accent }]}
            // Not connected yet: the whole row is the Connect button (it looked like one, Nov 12).
            onPress={
              driveEmail
                ? undefined
                : () =>
                    void online(
                      async () => setDriveEmail((await cloud.connectDrive()).email),
                      () => go({ k: 'refused', forNew: true }),
                    )
            }
          >
            <Icon name="cloud" size={18} color={colors.accent} strokeWidth={1.9} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.userEmail, { color: driveEmail ? colors.ink : colors.accent }]}>{driveEmail ?? s.connectDrive}</Text>
              <Text style={[styles.small, { color: colors.inkMuted }]}>{s.driveLine}</Text>
            </View>
            {driveEmail ? (
              <LinkButton
                label={s.change}
                onPress={() =>
                  void online(
                    async () => setDriveEmail((await cloud.connectDrive({ another: true })).email),
                    () => go({ k: 'refused', forNew: true }),
                  )
                }
              />
            ) : null}
          </Card>
          <Field label={s.passwordLabel} value={password} onChangeText={(v) => (setPassword(v), setPwError(null))} secureTextEntry placeholder={s.passwordHint} autoCapitalize="none" />
          <Field label={s.passwordAgain} value={password2} onChangeText={(v) => (setPassword2(v), setPwError(null))} secureTextEntry autoCapitalize="none" />
          {pwError ? <Note tone="red">{pwError}</Note> : null}
          <Note tone="amber" icon="key">
            {s.passwordMatters}
          </Note>
          <BottomSheet visible={skipSheet} onClose={() => setSkipSheet(false)} title={s.skipTitle}>
            <View style={{ gap: 12 }}>
              <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.skipBody}</Text>
              <Button label={s.goBack} onPress={() => setSkipSheet(false)} />
              <Button label={s.skipBackup} kind="secondary" onPress={() => (setSkipSheet(false), void complete(false))} />
            </View>
          </BottomSheet>
        </StartPage>
      );
    }

    case 'key':
      return (
        <StartPage step={4} title={s.keyShownTitle} body={s.keyShownBody} footer={<Button label={s.savedIt} onPress={() => (setCheck(['', '']), setCheckError(false), go({ k: 'check' }))} />}>
          {recoveryKey ? <RecoveryKeyCard recoveryKey={recoveryKey} /> : null}
        </StartPage>
      );

    case 'check':
      return (
        <StartPage
          onBack={back}
          title={s.checkTitle}
          body={s.checkBody(checkGroups[0], checkGroups[1])}
          footer={
            <>
              <LinkButton label={s.showAgain} onPress={back} />
              <Button
                label={busy ? s.working : s.continue}
                disabled={busy || check.some((c) => c.trim().length < 4)}
                onPress={() => {
                  const ok = check.every((c, i) => normalizeRecoveryKey(c) === groups[checkGroups[i] - 1]);
                  if (!ok) return setCheckError(true);
                  go({ k: 'pin' });
                }}
              />
            </>
          }
        >
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {checkGroups.map((g, i) => (
              <View key={g} style={{ flex: 1 }}>
                <Field
                  label={s.group(g)}
                  value={check[i]}
                  onChangeText={(v) => (setCheck((c) => c.map((x, j) => (j === i ? v.toUpperCase().slice(0, 4) : x))), setCheckError(false))}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={4}
                  style={styles.keyInput}
                />
              </View>
            ))}
          </View>
          {checkError ? <Note tone="red">{s.checkWrong}</Note> : null}
        </StartPage>
      );

    case 'pin':
      return (
        <StartPage
          icon="lock"
          title={strings.lock.offerTitle}
          body={strings.lock.offerBody}
          footer={
            <>
              <Button label={busy ? s.working : strings.lock.setPin} disabled={busy} onPress={() => void complete(!!user, true)} />
              <LinkButton label={strings.lock.notNow} onPress={() => void complete(!!user)} />
            </>
          }
        >
          <Note tone="teal" icon="tick">
            {strings.lock.offerNote}
          </Note>
          <ToggleRow title={strings.lock.offerBiometrics} value={offerBio} onChange={setOfferBio} />
        </StartPage>
      );

    case 'done': {
      const state = getDeviceState(db);
      return (
        <StartPage
          centered
          icon="check"
          title={s.doneTitle}
          body={s.doneBody(accountCount)}
          footer={
            <>
              <Button
                label={s.logWithdrawal}
                onPress={() => {
                  router.replace('/');
                  router.push({ pathname: '/accounts', params: { from: 'setup' } });
                }}
              />
              <Button label={s.goHome} kind="secondary" onPress={() => router.replace('/')} />
            </>
          }
        >
          {state.backupEnabled ? (
            <>
              <Note tone="teal" icon="cloud">
                {s.backupOn(state.driveEmail ?? '')}
              </Note>
              {backupProgress ? <BackupProgressCard progress={backupProgress} /> : null}
            </>
          ) : (
            <Note tone="amber" icon="cloud">
              {user ? s.backupOff : s.guestBackupOff}
            </Note>
          )}
          <Card style={{ gap: 4, padding: 16 }}>
            <Text style={[styles.userEmail, { color: colors.ink }]}>{s.realRateTitle}</Text>
            <Text style={[styles.small, { color: colors.inkSecondary }]}>{s.realRateBody}</Text>
          </Card>
        </StartPage>
      );
    }
  }
}

const styles = StyleSheet.create({
  welcome: { flex: 1, paddingHorizontal: 24, paddingTop: 36, paddingBottom: 28, gap: 14 },
  welcomeMain: { flex: 1, justifyContent: 'center', gap: 22 },
  logo: { width: 60, height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: fonts.serif, fontSize: 30 },
  welcomeTitle: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 27, textAlign: 'center', maxWidth: 300 },
  welcomeBody: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20, textAlign: 'center', maxWidth: 290 },
  example: { width: 270, alignSelf: 'center', padding: 16, gap: 6, transform: [{ rotate: '-1.6deg' }] },
  exampleTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  exampleTag: { fontFamily: fonts.sansExtraBold, fontSize: 9.5, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  lbl: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.5 },
  mono: { fontFamily: fonts.mono, fontSize: 13 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
  body: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20 },
  staysRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  avatar: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.sansBold, fontSize: 13 },
  userEmail: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  infoValue: { flex: 1, fontFamily: fonts.sansSemiBold, fontSize: 13.5 },
  codeInput: { fontFamily: fonts.mono, fontSize: 22, letterSpacing: 8, textAlign: 'center' },
  keyInput: { fontFamily: fonts.mono, fontSize: 16, letterSpacing: 2 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 8 },
  barFill: { height: '100%', borderRadius: 4 },
});
