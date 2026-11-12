import { goBack } from '@/state/nav';
import { eq } from 'drizzle-orm';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { CurrencySheet } from '@/components/sheets/CurrencySheet';
import { BottomSheet, Button, Field, Header, LinkButton, Screen, SectionLabel, SheetOption, ToggleRow } from '@/components/ui';
import { FREE_LIMITS, usage } from '@/data/limits';
import { deleteSarrafAccount, signOut } from '@/data/sarraf-account';
import { deleteAllStoredFiles } from '@/services/attachments';
import { backupDeps } from '@/services/cloud';
import { usePlan } from '@/state/plan';
import { useToast } from '@/state/toast';
import { currentUser, getDeviceState } from '@/data/backup-flow';
import { useLive } from '@/state/live';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { NUMBER_FORMATS } from '@/lib/money';
import { useSettings } from '@/state/settings';
import { fonts, useTheme } from '@/theme';

type SettingsChanges = Partial<typeof settings.$inferInsert>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Check({ checked, locked, title, detail, onPress }: { checked: boolean; locked?: boolean; title: string; detail: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={locked} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: locked }} style={styles.check}>
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
  const [sheet, setSheet] = useState<'currency' | 'format' | 'theme' | 'fiscal' | 'signout' | 'delete' | null>(null);
  const [deleteText, setDeleteText] = useState('');
  const [deleteDrive, setDeleteDrive] = useState(false);
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
          onPress={() => (user ? undefined : router.push('/start'))}
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

      {user ? (
        <View style={{ gap: 8, marginTop: 10 }}>
          <Button label={s.signOut} kind="danger" onPress={() => setSheet('signout')} />
          <Text style={[styles.sheetNote, { color: colors.inkMuted, textAlign: 'center', paddingTop: 0 }]}>{s.signOutNote}</Text>
          <LinkButton label={s.deleteAccount} danger onPress={() => (setDeleteText(''), setDeleteDrive(false), setSheet('delete'))} />
        </View>
      ) : null}

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
          <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.signOutNote}</Text>
          <Button
            label={s.signOut}
            style={{ backgroundColor: colors.expense }}
            onPress={async () => {
              setSheet(null);
              await signOut(backupDeps(), new Date().toISOString());
              toast({ message: s.signedOut });
              router.replace('/start');
            }}
          />
          <Button label={strings.common.cancel} kind="secondary" onPress={() => setSheet(null)} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title={s.deleteTitle}>
        <ScrollView style={{ maxHeight: 620 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 12 }}>
            <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.deleteBody}</Text>
            {[
              { on: true, title: s.deleteAccountItem, detail: s.deleteAccountDetail(user?.email ?? '') },
              { on: true, title: s.deletePhoneItem, detail: s.deletePhoneDetail },
            ].map((it) => (
              <Check key={it.title} checked locked title={it.title} detail={it.detail} />
            ))}
            <Check checked={deleteDrive} title={s.deleteDriveItem} detail={s.deleteDriveDetail} onPress={() => setDeleteDrive(!deleteDrive)} />
            <View style={[styles.note, { backgroundColor: colors.warningSoft }]}>
              <Text style={[styles.body, { color: colors.ink, fontSize: 12 }]}>
                <Text style={{ fontFamily: fonts.sansBold }}>{s.payingTitle}</Text>
                {s.paying}
              </Text>
            </View>
            <Field label={s.typeDelete} value={deleteText} onChangeText={setDeleteText} autoCapitalize="characters" placeholder="DELETE" />
            <Button
              label={busy ? strings.backup.working : s.deleteAccount}
              style={{ backgroundColor: colors.expense }}
              disabled={busy || deleteText.trim() !== 'DELETE'}
              onPress={async () => {
                setBusy(true);
                try {
                  await deleteSarrafAccount(backupDeps(), { deleteDriveBackup: deleteDrive, deleteFiles: deleteAllStoredFiles });
                  setSheet(null);
                  toast({ message: s.deleted });
                  router.replace('/start');
                } catch (e) {
                  toast({ message: (e as Error).message });
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button label={s.keepAccount} kind="secondary" onPress={() => setSheet(null)} />
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
