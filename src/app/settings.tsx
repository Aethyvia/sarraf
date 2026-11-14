import { goBack } from '@/state/nav';
import { eq } from 'drizzle-orm';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { CurrencySheet } from '@/components/sheets/CurrencySheet';
import { BottomSheet, Button, Field, Header, LinkButton, Screen, SectionLabel, SheetOption, ToggleRow } from '@/components/ui';
import { Note } from '@/components/start/StartPage';
import { FREE_LIMITS, usage } from '@/data/limits';
import { deleteChosen, signOut, type DeleteChoice } from '@/data/sarraf-account';
import { deleteAllStoredFiles } from '@/services/attachments';
import { backupDeps, cloud } from '@/services/cloud';
import { usePlan } from '@/state/plan';
import { useToast } from '@/state/toast';
import { currentUser, getDeviceState , backupNow } from '@/data/backup-flow';
import { useLive } from '@/state/live';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { NUMBER_FORMATS } from '@/lib/money';
import { useSettings } from '@/state/settings';
import { backupProblem } from '@/data/backup-errors';
import { formatShortDate } from '@/lib/format-date';
import { fonts, useTheme } from '@/theme';

type SettingsChanges = Partial<typeof settings.$inferInsert>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Check({ checked, locked, title, detail, onPress }: { checked: boolean; locked?: boolean; title: string; detail: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={locked} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: locked }} style={[styles.check, locked && { opacity: 0.45 }]}>
      <View style={[styles.box, checked ? { backgroundColor: colors.expense } : { borderWidth: 1.5, borderColor: colors.border }]}>
        {checked ? <Icon name="tick" size={12} color="#FFFFFF" strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.checkTitle, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.sheetNote, { color: colors.inkMuted, paddingTop: 1, paddingHorizontal: 0 }]}>{detail}</Text>
      </View>
    </Pressable>
  );
}

function save(values: SettingsChanges) {
  db.update(settings).set({ ...values, updatedAt: new Date().toISOString() }).where(eq(settings.id, 1)).run();
}

export default function SettingsScreen() {
  const s = strings.settings;
  const current = useSettings();
  const { colors } = useTheme();
  const [sheet, setSheet] = useState<'currency' | 'format' | 'theme' | 'fiscal' | 'signout' | 'delete' | 'profile' | null>(null);
  const [deleteText, setDeleteText] = useState('');
  // Each part is chosen on its own (owner, Nov 12). Starts with just the account ticked.
  const [deleting, setDeleting] = useState<DeleteChoice>({ account: true, phone: false, drive: false });
  // Greyed out when there's nothing to delete (owner, Nov 14): a guest has no account or backup; a signed-in person may have no backup.
  const [hasBackup, setHasBackup] = useState<boolean | null>(null);
  // Sign out: back up first when backup is on; a failed backup says why and offers "Sign out anyway".
  const [signOutProblem, setSignOutProblem] = useState<string | null>(null);
  const [eraseText, setEraseText] = useState('');
  const [removeData, setRemoveData] = useState(true);
  const openSignOut = () => (setSignOutProblem(null), setEraseText(''), setRemoveData(true), setSheet('signout'));
  const doSignOut = async (backUpFirst: boolean) => {
    setBusy(true);
    try {
      if (backUpFirst) {
        const r = await backupNow(backupDeps()).catch((e: unknown) => e);
        if (!(r && typeof r === 'object' && 'ok' in r && r.ok)) {
          setSignOutProblem(backupProblem(r));
          return;
        }
      }
      await signOut(backupDeps(), { removeData, deleteFiles: deleteAllStoredFiles, now: new Date().toISOString() });
      setSheet(null);
      toast({ message: s.signedOut });
      router.replace('/start');
    } catch (e) {
      toast({ message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const openDelete = () => {
    setDeleteText('');
    setDeleting({ account: !!user, phone: !user, drive: false });
    setHasBackup(user ? (device.lastBackupAt ? true : null) : false);
    setSheet('delete');
    // Another phone may have made the backup: the record says so.
    if (user && !device.lastBackupAt) {
      void cloud
        .getRecord(user)
        .then((r) => setHasBackup(!!r))
        .catch(() => setHasBackup(null));
    }
  };
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const plan = usePlan();
  const accountsUsed = useLive((d) => usage(d, 'accounts'), []);
  const go = (href: Href) => router.push(href);
  const device = useLive(() => getDeviceState(db), []);
  const user = currentUser(db);

  return (
    <Screen>
      <Header size={24} title={s.title} onBack={goBack} />

      <SectionLabel style={styles.section}>{s.profile}</SectionLabel>
      <View>
        <Row
          icon="user"
          title={user?.email ?? s.notSignedIn}
          hint={user ? s.signedInWith(strings.start.methods[user.method]) : undefined}
          onPress={() => (user ? setSheet('profile') : router.push('/start'))}
        />
        <Row
          icon="star"
          title={s.subscription}
          value={s.planUsage(plan === 'plus' ? strings.plans.plus : strings.plans.free, accountsUsed, plan === 'plus' ? null : FREE_LIMITS.accounts)}
          onPress={() => go('/plans')}
          last
        />
      </View>

      <SectionLabel style={styles.section}>{s.organize}</SectionLabel>
      <View>
        <Row icon="accounts" title={s.accounts} onPress={() => go('/accounts')} />
        <Row icon="list" title={s.categories} onPress={() => go('/categories')} />
        <Row icon="ledger" title={s.ledgers} onPress={() => go('/ledgers')} />
        <Row icon="people" title={s.people} onPress={() => go('/people')} />
        <Row icon="cycle" title={strings.recurring.title} onPress={() => go('/recurring')} />
        <Row icon="chart" title={strings.budgets.title} onPress={() => go('/budgets')} last />
      </View>

      <SectionLabel style={styles.section}>{s.preferences}</SectionLabel>
      <View>
        <Row icon="coin" title={s.defaultCurrency} value={current.defaultCurrency} mono hint={s.defaultCurrencyHint} onPress={() => setSheet('currency')} />
        <Row icon="rows" title={s.numberFormat} value={current.numberFormat} mono hint={s.numberFormatHint} onPress={() => setSheet('format')} />
        <Row
          icon="calendar"
          title={s.fiscalYear}
          value={`${MONTHS[current.fiscalYearStartMonth - 1].slice(0, 3)} – ${MONTHS[(current.fiscalYearStartMonth + 10) % 12].slice(0, 3)}`}
          hint={s.fiscalYearHint}
          onPress={() => setSheet('fiscal')}
        />
        <Row icon="moon" title={s.theme} value={s.themes[current.theme]} onPress={() => setSheet('theme')} />
        <Row
          icon="bell"
          title={strings.notifications.title}
          value={strings.notifications.onCount(
            [current.notifyBudget80, current.notifyBudget100, current.notifyRecurringDue, current.notifyExpectedLate, current.notifyInTransit, current.notifyBackupProblems].filter(Boolean).length,
          )}
          onPress={() => go('/notifications')}
          last
        />
      </View>
      <ToggleRow title={s.compactNumbers} detail={s.compactNumbersDetail} value={current.compactNumbers} onChange={(v) => save({ compactNumbers: v })} />

      <SectionLabel style={styles.section}>{s.security}</SectionLabel>
      <View>
        <Row
          icon="lock"
          title={s.appLock}
          value={current.appLockEnabled && current.pinHash ? s.appLockOn(current.biometricsEnabled) : s.appLockOff}
          onPress={() => go('/app-lock')}
          last
        />
      </View>
      <ToggleRow title={s.hideAmounts} detail={s.hideAmountsDetail} value={current.hideAmounts} onChange={(v) => save({ hideAmounts: v })} />

      <SectionLabel style={styles.section}>{s.analytics}</SectionLabel>
      <ToggleRow title={s.incomeByPerson} detail={s.incomeByPersonDetail} value={current.showIncomeByPerson} onChange={(v) => save({ showIncomeByPerson: v })} />
      <ToggleRow
        title={s.fiscalForAnalytics}
        detail={
          current.fiscalYearStartMonth === 1
            ? s.fiscalForAnalyticsSame
            : s.fiscalForAnalyticsDetail(
                current.fiscalYearForAnalytics,
                MONTHS[current.fiscalYearStartMonth - 1].slice(0, 3),
                `${MONTHS[current.fiscalYearStartMonth - 1].slice(0, 3)} – ${MONTHS[(current.fiscalYearStartMonth + 10) % 12].slice(0, 3)}`,
              )
        }
        value={current.fiscalYearForAnalytics}
        onChange={(v) => save({ fiscalYearForAnalytics: v })}
      />

      <SectionLabel style={styles.section}>{s.reports}</SectionLabel>
      <View>
        <Row icon="document" title={s.taxExport} onPress={() => go('/tax-export')} last />
      </View>
      <SectionLabel style={styles.section}>{s.data}</SectionLabel>
      <View>
        <Row icon="down" title={s.exportData} onPress={() => go('/export')} />
        <Row icon="sort" title={s.importCsv} onPress={() => go('/import')} />
        <Row
          icon="layers"
          title={s.backup}
          value={device.backupMovedAt ? s.backupMoved : device.backupEnabled ? s.backupOn : s.backupOff}
          onPress={() => go('/backup')}
          last
        />
      </View>

      <SectionLabel style={styles.section}>{s.about}</SectionLabel>
      <View>
        <Row icon="document" title={s.terms} onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })} />
        <Row icon="shield" title={s.privacy} onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })} last />
      </View>

      {user ? (
        <View style={{ gap: 8, marginTop: 10 }}>
          <Button label={s.signOut} kind="danger" onPress={openSignOut} />
          <Text style={[styles.sheetNote, { color: colors.inkMuted, textAlign: 'center', paddingTop: 0 }]}>{s.signOutNote}</Text>
          <LinkButton label={s.deleteEllipsis} danger onPress={openDelete} />
        </View>
      ) : (
        <View style={{ marginTop: 10 }}>
          <LinkButton label={s.deleteEllipsis} danger onPress={openDelete} />
        </View>
      )}

      <BottomSheet visible={sheet === 'fiscal'} onClose={() => setSheet(null)} title={s.fiscalYearStarts}>
        <ScrollView style={{ maxHeight: 480 }}>
          {MONTHS.map((m, i) => (
            <SheetOption
              key={m}
              title={m}
              selected={current.fiscalYearStartMonth === i + 1}
              onPress={() => {
                save({ fiscalYearStartMonth: i + 1 });
                setSheet(null);
              }}
            />
          ))}
        </ScrollView>
      </BottomSheet>

      <BottomSheet visible={sheet === 'signout'} onClose={() => setSheet(null)} title={s.signOutConfirm}>
        <View style={{ gap: 12 }}>
          {/* Owner, Nov 14: a box, ticked at first, takes the data off this phone; the Drive backup stays. */}
          <Check
            checked={removeData}
            title={s.removeDataItem}
            detail={s.removeDataDetail}
            onPress={() => (setRemoveData((v) => !v), setSignOutProblem(null), setEraseText(''))}
          />
          {!removeData ? (
            <>
              <Text style={[styles.sheetNote, { color: colors.inkMuted }]}>{s.signOutKeepNote}</Text>
              <Button label={busy ? strings.backup.working : s.signOut} style={{ backgroundColor: colors.expense }} disabled={busy} onPress={() => void doSignOut(false)} />
            </>
          ) : device.backupEnabled ? (
            <>
              {device.lastBackupAt ? <Text style={[styles.sheetNote, { color: colors.inkMuted }]}>{s.signOutLastBackup(formatShortDate(device.lastBackupAt.slice(0, 10)))}</Text> : null}
              {signOutProblem ? <Note tone="red">{s.signOutBackupFailed(signOutProblem)}</Note> : null}
              <Button
                label={busy ? strings.backup.working : signOutProblem ? s.signOutAnyway : s.backUpAndSignOut}
                style={{ backgroundColor: colors.expense }}
                disabled={busy}
                onPress={() => void doSignOut(!signOutProblem)}
              />
            </>
          ) : (
            <>
              <Note tone="red">{s.signOutNoBackup}</Note>
              <Button label={s.turnOnBackupFirst} onPress={() => (setSheet(null), go('/backup'))} />
              <Field label={s.typeErase} value={eraseText} onChangeText={setEraseText} autoCapitalize="characters" placeholder="ERASE" />
              <Button
                label={busy ? strings.backup.working : s.signOutAndErase}
                style={{ backgroundColor: colors.expense }}
                disabled={busy || eraseText.trim() !== 'ERASE'}
                onPress={() => void doSignOut(false)}
              />
            </>
          )}
          <Button label={strings.common.cancel} kind="secondary" onPress={() => setSheet(null)} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === 'profile'} onClose={() => setSheet(null)} title={s.sarrafAccount}>
        <View style={{ gap: 12 }}>
          <View style={{ paddingHorizontal: 4, gap: 2 }}>
            <Text style={[styles.checkTitle, { color: colors.ink }]}>{user?.email}</Text>
            <Text style={[styles.sheetNote, { color: colors.inkMuted, paddingHorizontal: 0, paddingTop: 0 }]}>
              {user ? s.signedInWith(strings.start.methods[user.method]) : ''}
            </Text>
          </View>
          <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.accountExplain}</Text>
          <SheetOption title={s.backup} detail={device.backupEnabled ? (device.driveEmail ?? s.backupOn) : s.backupOff} onPress={() => (setSheet(null), go('/backup'))} />
          <SheetOption title={s.subscription} detail={plan === 'plus' ? strings.plans.plus : strings.plans.free} onPress={() => (setSheet(null), go('/plans'))} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title={s.deleteWhatTitle}>
        <ScrollView style={{ maxHeight: 620 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 12 }}>
            <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.deleteWhatBody}</Text>
            <Check
              checked={deleting.account}
              locked={!user}
              title={s.deleteAccountItem}
              detail={user ? s.deleteAccountDetail(user.email) : s.deleteNoAccount}
              onPress={() => setDeleting((d) => ({ ...d, account: !d.account }))}
            />
            <Check checked={deleting.phone} title={s.deletePhoneItem} detail={s.deletePhoneDetail} onPress={() => setDeleting((d) => ({ ...d, phone: !d.phone }))} />
            <Check
              checked={deleting.drive}
              locked={hasBackup === false}
              title={s.deleteDriveItem}
              detail={!user ? s.deleteNoBackupGuest : hasBackup === false ? s.deleteNoBackup : s.deleteDriveDetail}
              onPress={() => setDeleting((d) => ({ ...d, drive: !d.drive }))}
            />
            {deleting.account && !deleting.phone ? <Note tone="teal">{s.keepsPhoneData}</Note> : null}
            {deleting.phone && !deleting.drive && !device.lastBackupAt ? <Note tone="red">{s.noBackupWarn}</Note> : null}
            {deleting.account ? (
              <View style={[styles.note, { backgroundColor: colors.warningSoft }]}>
                <Text style={[styles.body, { color: colors.ink, fontSize: 12 }]}>
                  <Text style={{ fontFamily: fonts.sansBold }}>{s.payingTitle}</Text>
                  {s.paying}
                </Text>
              </View>
            ) : null}
            <Field label={s.typeDelete} value={deleteText} onChangeText={setDeleteText} autoCapitalize="characters" placeholder="DELETE" />
            <Button
              label={busy ? strings.backup.working : s.deleteButton(deleting)}
              style={{ backgroundColor: colors.expense }}
              disabled={busy || deleteText.trim() !== 'DELETE' || !(deleting.account || deleting.phone || deleting.drive)}
              onPress={async () => {
                setBusy(true);
                try {
                  await deleteChosen(backupDeps(), deleting, { deleteFiles: deleteAllStoredFiles, now: new Date().toISOString() });
                  setSheet(null);
                  toast({ message: s.deletedWhat(deleting) });
                  if (deleting.account || deleting.phone) router.replace('/start');
                } catch (e) {
                  toast({ message: (e as Error).message });
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button label={strings.common.cancel} kind="secondary" onPress={() => setSheet(null)} />
          </View>
        </ScrollView>
      </BottomSheet>

      <CurrencySheet
        visible={sheet === 'currency'}
        selected={current.defaultCurrency}
        onSelect={(code) => save({ defaultCurrency: code })}
        onClose={() => setSheet(null)}
      />
      <BottomSheet visible={sheet === 'format'} onClose={() => setSheet(null)} title={s.numberFormat}>
        {NUMBER_FORMATS.map((f) => (
          <SheetOption
            key={f}
            title={f.replace(/ /g, ' ')}
            detail={s.numberFormats[f]}
            selected={current.numberFormat === f}
            onPress={() => {
              save({ numberFormat: f });
              setSheet(null);
            }}
          />
        ))}
        <Text style={[styles.sheetNote, { color: colors.inkMuted }]}>{s.numberFormatPkr}</Text>
      </BottomSheet>
      <BottomSheet visible={sheet === 'theme'} onClose={() => setSheet(null)} title={s.theme}>
        {(['system', 'light', 'dark'] as const).map((t) => (
          <SheetOption
            key={t}
            title={s.themes[t]}
            selected={current.theme === t}
            onPress={() => {
              save({ theme: t });
              setSheet(null);
            }}
          />
        ))}
      </BottomSheet>
    </Screen>
  );
}

function Row({
  icon,
  title,
  value,
  mono,
  hint,
  onPress,
  last,
}: {
  icon: string;
  title: string;
  value?: string;
  mono?: boolean;
  hint?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [!last && { borderBottomWidth: 1, borderBottomColor: colors.line }, pressed && { opacity: 0.7 }]}>
      <View style={styles.row}>
        <View style={[styles.rowIcon, { backgroundColor: colors.filled }]}>
          <Icon name={icon} size={16} color={colors.inkSecondary} strokeWidth={1.8} />
        </View>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>
        {value ? <Text style={[mono ? styles.valueMono : styles.value, { color: colors.inkMuted }]}>{value}</Text> : null}
        <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} />
      </View>
      {hint ? <Text style={[styles.hint, { color: colors.inkMuted }]}>{hint}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8, marginBottom: -8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  rowIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { flex: 1, fontFamily: fonts.sansSemiBold, fontSize: 14.5 },
  value: { fontFamily: fonts.sans, fontSize: 13.5 },
  valueMono: { fontFamily: fonts.mono, fontSize: 13.5 },
  hint: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingStart: 48, paddingEnd: 4, paddingBottom: 10, marginTop: -6 },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  note: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 4 },
  box: { width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkTitle: { fontFamily: fonts.sansSemiBold, fontSize: 13.5 },
  sheetNote: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingTop: 10, paddingHorizontal: 4 },
});
