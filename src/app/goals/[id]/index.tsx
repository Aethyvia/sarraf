import { eq } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { BottomSheet, Button, Card, Field, Header, Screen, SectionLabel, SelectorRow } from '@/components/ui';
import { completeGoal, goalByAccount, goalHistory, goalTotal, stillToGo, takeOutOfGoal } from '@/data/goals';
import { db } from '@/db/client';
import { accounts, savingsGoals } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { Decimal, dec, parseTypedAmount, toDecimalString } from '@/lib/money';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { goBack } from '@/state/nav';
import { useSettings } from '@/state/settings';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Goal page (Decided Nov 6): what it holds of its target, Add money, Take money
 * out, Edit target, Mark as complete, By account, and its history.
 */
export default function GoalScreen() {
  const s = strings.goals;
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const toast = useToast();
  const action = useAction();
  const [sheet, setSheet] = useState<'takeOut' | 'complete' | null>(null);
  const data = useLive(
    (d) => {
      const goal = d.select().from(savingsGoals).where(eq(savingsGoals.id, id)).get();
      if (!goal) return null;
      const names = new Map(d.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map((a) => [a.id, a.name]));
      return { goal, held: goalTotal(d, id), byAccount: goalByAccount(d, id), history: goalHistory(d, id), names };
    },
    [id],
  );
  if (!data) return null;
  const { goal, held, byAccount, history, names } = data;
  const money = (v: string, style?: object) => <Money value={v} currency={goal.currency} allowCompact={false} style={style} />;
  const pct = dec(goal.targetAmount).gt(0) ? Math.min(100, Math.floor(dec(held).dividedBy(dec(goal.targetAmount)).times(100).toNumber())) : 0;
  const rest = stillToGo(goal.targetAmount, held);
  const open = !goal.completedAt;

  return (
    <Screen>
      <Header size={20} title={goal.name} subtitle={s.subtitle(goal.currency)} onBack={goBack} />
      {action.ui}
      <Card style={styles.summary}>
        <View style={styles.summaryTop}>
          {money(held, [styles.held, { color: colors.ink }])}
          <Text style={[styles.small, { color: colors.inkMuted }]}>{parts(s.of(money(goal.targetAmount, [styles.small, { color: colors.inkMuted }])))}</Text>
        </View>
        <View style={[styles.track, { backgroundColor: colors.filled }]}>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.accent }]} />
        </View>
        <View style={styles.summaryBottom}>
          <Text style={[styles.small, { color: colors.inkMuted }]}>{goal.completedAt ? s.completed : s.there(pct)}</Text>
          <Text style={[styles.small, { color: colors.inkMuted }]}>{dec(rest).isZero() ? s.reached : parts(s.toGo(money(rest, [styles.small, { color: colors.inkMuted }])))}</Text>
        </View>
      </Card>

      {open ? (
        <>
          <View style={styles.buttons}>
            <Button label={s.addMoney} style={{ flex: 1 }} onPress={() => router.push({ pathname: '/transaction/new', params: { kind: 'savings', goal: id } })} />
            <Button kind="secondary" label={s.takeOut} style={{ flex: 1 }} disabled={dec(held).lte(0)} onPress={() => setSheet('takeOut')} />
          </View>
          <View style={[styles.buttons, { marginTop: -6 }]}>
            <Button kind="secondary" label={s.editTarget} style={{ flex: 1 }} onPress={() => router.push(`/goals/${id}/edit`)} />
            <Button kind="secondary" label={s.complete} style={{ flex: 1 }} onPress={() => setSheet('complete')} />
          </View>
        </>
      ) : null}

      {byAccount.length ? (
        <View>
          <SectionLabel style={styles.label}>{s.byAccount}</SectionLabel>
          <Card style={styles.list}>
            {byAccount.map((a, i) => (
              <View key={a.accountId} style={[styles.line, i < byAccount.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
                <Text style={[styles.lineTitle, { color: colors.ink }]}>{names.get(a.accountId)}</Text>
                <Text style={[styles.small, { color: colors.inkMuted }]}>{Math.round(dec(a.amount).dividedBy(dec(held)).times(100).toNumber())}%</Text>
                {money(a.amount, [styles.mono, { color: colors.ink }])}
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {history.length ? (
        <View>
          <SectionLabel style={styles.label}>{s.history}</SectionLabel>
          <Card style={styles.list}>
            {history.map((h, i) => (
              <View key={h.id} style={[styles.line, i < history.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
                <Text style={[styles.lineText, { color: colors.ink }]} numberOfLines={2}>
                  {s.kinds[h.kind]} · {formatShortDate(h.date)} ·{' '}
                  <Text style={{ color: colors.inkMuted }}>{[names.get(h.accountId), h.notes ?? (h.kind === 'shrink' ? s.shrinkNote : null)].filter(Boolean).join(' · ')}</Text>
                </Text>
                <Money value={h.amount} currency={goal.currency} sign="always" allowCompact={false} style={[styles.mono, { color: dec(h.amount).isNegative() ? colors.expense : colors.income }]} />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <Text style={[styles.note, { color: colors.inkMuted }]}>{s.footer(goal.currency)}</Text>
      <Text style={[styles.note, { color: colors.inkMuted }]}>{s.footer2}</Text>

      <TakeOutSheet visible={sheet === 'takeOut'} goalId={id} name={goal.name} currency={goal.currency} held={held} byAccount={byAccount} names={names} onClose={() => setSheet(null)} />
      <BottomSheet visible={sheet === 'complete'} onClose={() => setSheet(null)} title={s.completeTitle(goal.name)}>
        <View style={{ gap: 12 }}>
          <Text style={[styles.body, { color: colors.inkSecondary }]}>{parts(s.completeBody(money(held, styles.mono), goal.currency))}</Text>
          <Button
            label={s.complete}
            onPress={() => {
              if (action.run(() => (completeGoal(db, id), true))) {
                setSheet(null);
                toast({ message: s.completed });
              }
            }}
          />
          <Button kind="secondary" label={strings.common.cancel} onPress={() => setSheet(null)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

/** Take money out (Decided Nov 6): from an account, an amount or All, a note; back to Usable. */
function TakeOutSheet({
  visible,
  goalId,
  name,
  currency,
  held,
  byAccount,
  names,
  onClose,
}: {
  visible: boolean;
  goalId: string;
  name: string;
  currency: string;
  held: string;
  byAccount: { accountId: string; amount: string }[];
  names: Map<string, string>;
  onClose: () => void;
}) {
  const s = strings.goals;
  const { colors } = useTheme();
  const { numberFormat } = useSettings();
  const action = useAction();
  const toast = useToast();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const from = byAccount.find((a) => a.accountId === accountId) ?? byAccount[0];
  if (!from) return null;
  const amount = parseTypedAmount(text, numberFormat);
  const valid = !!amount && dec(amount).gt(0) && dec(amount).lte(dec(from.amount));
  const left = toDecimalString(Decimal.max(dec(held).minus(dec(amount ?? '0')), 0));
  const money = (v: string, style?: object) => <Money value={v} currency={currency} allowCompact={false} style={[styles.mono, style]} />;
  const close = () => {
    setText('');
    setNote('');
    setAccountId(null);
    onClose();
  };
  const save = () => {
    if (!valid) return;
    if (action.run(() => (takeOutOfGoal(db, { goalId, accountId: from.accountId, amount: amount!, notes: note }), true))) {
      toast({ message: s.tookOut });
      close();
    }
  };
  return (
    <BottomSheet visible={visible} onClose={close} title={s.takeOutTitle}>
      <View style={{ gap: 14 }}>
        {action.ui}
        <Text style={[styles.small, { color: colors.inkMuted, marginTop: -8 }]}>{parts(s.takeOutSub(name, money(held, { fontSize: 12.5 })))}</Text>
        <SelectorRow
          label={s.fromAccount}
          value={parts(s.inThisGoal(names.get(from.accountId) ?? '', money(from.amount, { fontSize: 13.5 })))}
          onPress={byAccount.length > 1 ? () => setPicking(true) : undefined}
        />
        <View>
          <Text style={[styles.fieldLabel, { color: colors.inkMuted }]}>{s.amount}</Text>
          <View style={[styles.amountBox, { borderColor: colors.accent, backgroundColor: colors.surface }]}>
            <Text style={[styles.code, { color: colors.inkSecondary }]}>{currency}</Text>
            <TextInput value={text} onChangeText={setText} keyboardType="numeric" placeholder="0.00" placeholderTextColor={colors.inkMuted} style={[styles.amountInput, { color: colors.ink }]} />
            <Text onPress={() => setText(from.amount)} style={[styles.all, { color: colors.accent }]}>
              {parts(s.all(money(from.amount, { fontSize: 12, color: colors.accent })))}
            </Text>
          </View>
          <View style={styles.leftRow}>
            <Text style={[styles.small, { color: colors.inkMuted }]}>{s.leftAfter}</Text>
            {money(left, { fontSize: 12 })}
          </View>
        </View>
        <Field label={s.note} optional value={note} onChangeText={setNote} placeholder={s.notePlaceholder} />
        {amount && valid ? <Text style={[styles.small, { color: colors.inkMuted, lineHeight: 17 }]}>{parts(s.takeOutExplain(money(amount, { fontSize: 11.5 }), currency))}</Text> : null}
        <Button label={valid ? parts(s.takeOutButton(money(amount!, { fontSize: 13.5, color: colors.onAccent }))) : s.takeOut} disabled={!valid} onPress={save} />
      </View>
      <PickerSheet
        visible={picking}
        title={s.fromAccount}
        sections={[{ items: byAccount.map((a) => ({ id: a.accountId, title: names.get(a.accountId) ?? '', trailing: money(a.amount) })) }]}
        selectedId={from.accountId}
        onSelect={(id) => setAccountId(id)}
        onClose={() => setPicking(false)}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  summary: { padding: 18 },
  summaryTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  held: { fontFamily: fonts.mono, fontSize: 28 },
  track: { height: 10, borderRadius: 5, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5 },
  summaryBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  small: { fontFamily: fonts.sans, fontSize: 11.5 },
  buttons: { flexDirection: 'row', gap: 10 },
  label: { paddingHorizontal: 2, paddingBottom: 6 },
  list: { paddingHorizontal: 16, paddingVertical: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  lineTitle: { flex: 1, fontFamily: fonts.sansSemiBold, fontSize: 13 },
  lineText: { flex: 1, fontFamily: fonts.sans, fontSize: 13 },
  mono: { fontFamily: fonts.mono, fontSize: 13 },
  note: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 18, paddingHorizontal: 4 },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  fieldLabel: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 5 },
  amountBox: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: radius.field, paddingHorizontal: 14 },
  code: { fontFamily: fonts.sansBold, fontSize: 11 },
  amountInput: { flex: 1, fontFamily: fonts.mono, fontSize: 17, paddingVertical: 10 },
  all: { fontFamily: fonts.sansBold, fontSize: 12, textDecorationLine: 'underline' },
  leftRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7, paddingHorizontal: 2 },
});
