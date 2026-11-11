import { goBack } from '@/state/nav';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { eq } from 'drizzle-orm';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AmountTextInput } from '@/components/AmountTextInput';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { useAccountSections, useCategorySections, usePeopleItems } from '@/components/sheets/pickers';
import { formatLongDate } from '@/components/transaction/parts';
import { BottomSheet, Button, Field, Header, IconButton, LinkButton, Screen, Segmented, SelectorRow, SheetOption, ToggleRow } from '@/components/ui';
import { createRecurring, deleteRecurring, SHOW_ON_HOME_DAYS, updateRecurring, type RecurringItem, type RepeatRule } from '@/data/recurring';
import { db } from '@/db/client';
import { accounts, categories, people } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { today as todayDate } from '@/lib/dates';
import { parseTypedAmount, toTypedText } from '@/lib/money';
import { notificationsAllowed } from '@/services/notifications';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { fonts, radius, useTheme } from '@/theme';

type Kind = 'expense' | 'income' | 'transfer';
type Sheet = 'account' | 'to' | 'category' | 'tag' | 'repeat' | 'ends' | 'show' | 'delete' | null;

/** How a rule reads: "Monthly, on the 12th". Bills say "around". */
export function ruleText(rule: RepeatRule, varies = false): string {
  const r = strings.recurring;
  switch (rule.freq) {
    case 'weekly':
      return r.ruleText.weekly(rule.interval, r.weekdays[rule.day]);
    case 'monthly':
      return r.ruleText.monthly(rule.interval, r.ordinal(rule.day), varies);
    case 'yearly':
      return r.ruleText.yearly(rule.interval, `${strings.dates.monthsLong[(rule.month ?? 1) - 1]} ${rule.day}`);
  }
}

/** Add recurring / Edit recurring (Spec §12): any kind can repeat, same amount or amount varies. */
export function RecurringForm({ item }: { item?: RecurringItem }) {
  const s = strings.recurring;
  const { colors } = useTheme();
  const { numberFormat } = useSettings();
  const action = useAction({ itemName: item?.name });
  const today = todayDate();
  const firstAccount = useLive((d) => d.select({ id: accounts.id }).from(accounts).orderBy(accounts.rank).get()?.id ?? null);
  const defaultDay = Number(today.slice(8, 10));

  const [kind, setKind] = useState<Kind>(item?.kind ?? 'expense');
  const [type, setType] = useState<'same' | 'varies'>(item?.amountType ?? 'same');
  const [name, setName] = useState(item?.name ?? '');
  const [amountText, setAmountText] = useState(item?.amount ? toTypedText(item.amount, numberFormat) : '');
  const [accountId, setAccountId] = useState<string | null>(item?.accountId ?? null);
  const [toAccountId, setToAccountId] = useState<string | null>(item?.toAccountId ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(item?.categoryId ?? null);
  const [personId, setPersonId] = useState<string | null>(item?.referencePersonId ?? null);
  const [rule, setRule] = useState<RepeatRule>((item?.repeatRule as RepeatRule) ?? { freq: 'monthly', interval: 1, day: defaultDay });
  const [endsOn, setEndsOn] = useState<string | null>(item?.endsOn ?? null);
  const [maxTimes, setMaxTimes] = useState<number | null>(item?.maxOccurrences ?? null);
  const [showDays, setShowDays] = useState<number>(item?.showOnHomeDays ?? 3);
  const [remind, setRemind] = useState(item ? !item.autoAdd : true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [timesText, setTimesText] = useState(maxTimes ? String(maxTimes) : '');

  const account = accountId ?? firstAccount;
  const names = useLive(
    (d) => ({
      account: account ? d.select().from(accounts).where(eq(accounts.id, account)).get() : undefined,
      to: toAccountId ? d.select().from(accounts).where(eq(accounts.id, toAccountId)).get() : undefined,
      category: categoryId ? d.select({ name: categories.name }).from(categories).where(eq(categories.id, categoryId)).get()?.name : undefined,
      person: personId ? d.select({ name: people.name }).from(people).where(eq(people.id, personId)).get()?.name : undefined,
    }),
    [account, toAccountId, categoryId, personId],
  );
  const accountSections = useAccountSections();
  const toSections = useAccountSections({ excludeId: account });
  const categorySections = useCategorySections(kind === 'income' ? 'income' : 'expense');
  const peopleItems = usePeopleItems();

  const varies = kind !== 'transfer' && type === 'varies';
  const amount = !varies ? parseTypedAmount(amountText, numberFormat) : null;
  const crossCurrency = kind === 'transfer' && names.to && names.account && names.to.currency !== names.account.currency;
  const canSave = name.trim() !== '' && !!account && (varies || !!amount) && (kind !== 'transfer' || !!toAccountId);

  const pickDate = (value: string, onPick: (d: string) => void) => {
    const [y, m, d] = value.split('-').map(Number);
    DateTimePickerAndroid.open({ value: new Date(y, m - 1, d), mode: 'date', onChange: (e, p) => e.type === 'set' && p && onPick(todayDate(p)) });
  };
  const save = () => {
    if (!canSave || !account) return;
    const input = {
      kind,
      amountType: varies ? ('varies' as const) : ('same' as const),
      name,
      amount,
      accountId: account,
      toAccountId: kind === 'transfer' ? toAccountId : null,
      categoryId: kind === 'transfer' ? null : categoryId,
      referencePersonId: kind === 'income' ? personId : null,
      ledgerId: item?.ledgerId ?? null,
      rule,
      showOnHomeDays: showDays,
      autoAdd: !varies && !remind,
      endsOn,
      maxOccurrences: maxTimes,
    };
    const ok = action.run(() => (item ? updateRecurring(db, item.id, input) : createRecurring(db, input), true));
    if (ok) {
      // A reminder is only useful if the phone allows notifications: ask now, once.
      void notificationsAllowed(true);
      goBack();
    }
  };

  const endsLabel = endsOn ? s.endsOn(formatLongDate(endsOn)) : maxTimes ? s.endsAfter(maxTimes) : s.never;

  return (
    <Screen>
      <Header
        title={item ? s.edit : s.add}
        onBack={goBack}
        backIcon="close"
        actions={<IconButton icon="tick" filled label={s.save} onPress={save} disabled={!canSave} />}
      />
      {action.ui}
      <Segmented
        options={(['expense', 'income', 'transfer'] as const).map((k) => ({ value: k, label: s.kinds[k] }))}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setCategoryId(null);
          if (k === 'transfer') setType('same');
        }}
      />
      {kind !== 'transfer' ? (
        <Segmented
          options={(['same', 'varies'] as const).map((t) => ({ value: t, label: s.types[t] }))}
          value={type}
          onChange={setType}
        />
      ) : null}
      <Text style={[styles.hint, { color: colors.inkMuted }]}>{kind === 'transfer' ? s.typeHint.transfer : s.typeHint[type]}</Text>

      <Field label={s.name} value={name} onChangeText={setName} placeholder={s.namePlaceholder} />
      {!varies ? (
        <View>
          <Text style={[styles.label, { color: colors.inkMuted }]}>{s.amount}</Text>
          <View style={[styles.amountBox, { backgroundColor: colors.filled }]}>
            <Text style={[styles.code, { color: colors.inkSecondary }]}>{names.account?.currency ?? ''}</Text>
            <AmountTextInput value={amountText} onChangeText={setAmountText} keyboardType="numeric" placeholder="0.00" placeholderTextColor={colors.inkMuted} style={[styles.amountInput, { color: colors.ink }]} />
          </View>
        </View>
      ) : null}

      <SelectorRow label={kind === 'transfer' ? s.from : s.account} value={names.account?.name ?? '—'} onPress={() => setSheet('account')} />
      {kind === 'transfer' ? (
        <SelectorRow label={s.to} value={names.to ? (crossCurrency ? s.toRateLater(names.to.name) : names.to.name) : '—'} onPress={() => setSheet('to')} />
      ) : (
        <SelectorRow label={s.category} value={names.category ?? strings.add.noCategory} onPress={() => setSheet('category')} />
      )}
      {kind === 'income' ? <SelectorRow label={s.tag} value={names.person ?? strings.common.none} onPress={() => setSheet('tag')} /> : null}
      <SelectorRow label={varies ? s.due : s.repeats} value={ruleText(rule, varies)} onPress={() => setSheet('repeat')} />
      <SelectorRow label={`${s.ends} ${s.optional}`} value={endsLabel} onPress={() => setSheet('ends')} />
      <SelectorRow label={s.showOnHome} value={s.showOptions(showDays)} onPress={() => setSheet('show')} />

      {varies ? (
        <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.billNote}</Text>
      ) : (
        <>
          <ToggleRow title={s.remind} value={remind} onChange={setRemind} />
          <Text style={[styles.hint, { color: colors.inkMuted, marginTop: -8 }]}>{kind === 'transfer' ? s.remindHintTransfer : s.remindHint}</Text>
        </>
      )}

      <Button label={s.save} disabled={!canSave} onPress={save} />
      {item ? <LinkButton danger label={s.delete} onPress={() => setSheet('delete')} /> : null}

      <PickerSheet visible={sheet === 'account'} title={kind === 'transfer' ? strings.add.from : strings.add.account} sections={accountSections} selectedId={account} onSelect={setAccountId} onClose={() => setSheet(null)} />
      <PickerSheet visible={sheet === 'to'} title={strings.add.to} sections={toSections} selectedId={toAccountId} onSelect={setToAccountId} onClose={() => setSheet(null)} />
      <PickerSheet
        visible={sheet === 'category'}
        title={strings.add.category}
        searchPlaceholder="Search categories"
        sections={categorySections}
        selectedId={categoryId}
        clearLabel={strings.add.noCategory}
        onSelect={(id) => setCategoryId(id || null)}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'tag'}
        title={strings.add.tag}
        searchPlaceholder="Search people"
        sections={[{ items: peopleItems }]}
        selectedId={personId}
        clearLabel={strings.common.none}
        onSelect={(id) => setPersonId(id || null)}
        onClose={() => setSheet(null)}
      />

      <BottomSheet visible={sheet === 'repeat'} onClose={() => setSheet(null)} title={varies ? s.sheetTitles.due : s.sheetTitles.repeats}>
        <View style={{ gap: 12 }}>
          <Segmented
            options={(['weekly', 'monthly', 'yearly'] as const).map((f) => ({ value: f, label: s.freq[f] }))}
            value={rule.freq}
            onChange={(freq) =>
              setRule((r) => ({
                freq,
                interval: r.interval,
                day: freq === 'weekly' ? Math.min(r.day, 6) : freq === r.freq ? r.day : defaultDay,
                month: freq === 'yearly' ? Number(today.slice(5, 7)) : undefined,
              }))
            }
          />
          <View style={styles.stepper}>
            <Text style={[styles.stepText, { color: colors.ink }]}>{s.every(rule.interval, rule.freq)}</Text>
            <View style={styles.stepButtons}>
              <Button kind="secondary" label="−" disabled={rule.interval <= 1} onPress={() => setRule((r) => ({ ...r, interval: Math.max(1, r.interval - 1) }))} />
              <Button kind="secondary" label="+" disabled={rule.interval >= 12} onPress={() => setRule((r) => ({ ...r, interval: Math.min(12, r.interval + 1) }))} />
            </View>
          </View>
          {rule.freq === 'weekly' ? (
            <View style={styles.chips}>
              {s.weekdaysShort.map((d, i) => (
                <Chip key={d} label={d} on={rule.day === i} onPress={() => setRule((r) => ({ ...r, day: i }))} />
              ))}
            </View>
          ) : rule.freq === 'monthly' ? (
            <View>
              <Text style={[styles.label, { color: colors.inkMuted }]}>{s.dayOfMonth.toUpperCase()}</Text>
              <View style={styles.chips}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <Chip key={d} label={String(d)} on={rule.day === d} onPress={() => setRule((r) => ({ ...r, day: d }))} small />
                ))}
              </View>
              {rule.day > 28 ? <Text style={[styles.hint, { color: colors.inkMuted, marginTop: 6 }]}>{s.lastDayNote}</Text> : null}
            </View>
          ) : (
            <SelectorRow
              label={s.pickDate.toUpperCase()}
              value={`${strings.dates.monthsLong[(rule.month ?? 1) - 1]} ${rule.day}`}
              onPress={() =>
                pickDate(`${today.slice(0, 4)}-${String(rule.month ?? 1).padStart(2, '0')}-${String(rule.day).padStart(2, '0')}`, (d) =>
                  setRule((r) => ({ ...r, month: Number(d.slice(5, 7)), day: Number(d.slice(8, 10)) })),
                )
              }
            />
          )}
          <Button label={s.done} onPress={() => setSheet(null)} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === 'ends'} onClose={() => setSheet(null)} title={s.sheetTitles.ends}>
        <SheetOption
          title={s.never}
          selected={!endsOn && !maxTimes}
          onPress={() => {
            setEndsOn(null);
            setMaxTimes(null);
            setSheet(null);
          }}
        />
        <SheetOption
          title={endsOn ? s.endsOn(formatLongDate(endsOn)) : s.onDate}
          selected={!!endsOn}
          onPress={() =>
            pickDate(endsOn ?? today, (d) => {
              setEndsOn(d);
              setMaxTimes(null);
              setSheet(null);
            })
          }
        />
        <View style={styles.timesRow}>
          <Text style={[styles.stepText, { color: colors.ink, flex: 1 }]}>{s.afterTimes}</Text>
          <TextInput
            value={timesText}
            onChangeText={setTimesText}
            keyboardType="number-pad"
            placeholder={s.times}
            placeholderTextColor={colors.inkMuted}
            style={[styles.timesInput, { backgroundColor: colors.filled, color: colors.ink }]}
          />
          <Button
            label={s.done}
            disabled={!/^\d+$/.test(timesText) || Number(timesText) < 1}
            onPress={() => {
              setMaxTimes(Number(timesText));
              setEndsOn(null);
              setSheet(null);
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === 'show'} onClose={() => setSheet(null)} title={s.sheetTitles.show}>
        {SHOW_ON_HOME_DAYS.map((n) => (
          <SheetOption
            key={n}
            title={s.showOptions(n)}
            selected={showDays === n}
            onPress={() => {
              setShowDays(n);
              setSheet(null);
            }}
          />
        ))}
      </BottomSheet>

      <BottomSheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title={item ? s.deleteTitle(item.name) : ''}>
        <View style={{ gap: 12 }}>
          <Text style={[styles.hint, { color: colors.inkSecondary, fontSize: 13 }]}>{s.deleteBody}</Text>
          <Button
            label={s.delete}
            style={{ backgroundColor: colors.expense }}
            onPress={() => {
              if (item && action.run(() => (deleteRecurring(db, item.id), true))) router.back();
            }}
          />
          <Button kind="secondary" label={strings.common.cancel} onPress={() => setSheet(null)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

function Chip({ label, on, onPress, small }: { label: string; on: boolean; onPress: () => void; small?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, small && styles.chipSmall, { backgroundColor: on ? colors.accent : colors.filled }]}
    >
      <Text style={[styles.chipText, { color: on ? colors.onAccent : colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 15, paddingHorizontal: 2 },
  label: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 5 },
  amountBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.field, paddingHorizontal: 14 },
  code: { fontFamily: fonts.sansBold, fontSize: 11 },
  amountInput: { flex: 1, fontFamily: fonts.mono, fontSize: 20, paddingVertical: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepText: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  stepButtons: { flexDirection: 'row', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8, minWidth: 44, alignItems: 'center' },
  chipSmall: { minWidth: 38, paddingHorizontal: 0, paddingVertical: 7 },
  chipText: { fontFamily: fonts.sansBold, fontSize: 12.5 },
  timesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  timesInput: { width: 70, fontFamily: fonts.mono, fontSize: 15, borderRadius: radius.field, paddingHorizontal: 10, paddingVertical: 8, textAlign: 'center' },
});
