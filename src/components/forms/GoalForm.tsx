import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { CurrencySheet } from '@/components/sheets/CurrencySheet';
import { BottomSheet, Button, Field, Header, Hint, IconButton, LinkButton, Screen, SelectorRow } from '@/components/ui';
import { createGoal, deleteGoal, goalTotal, updateGoal, type Goal } from '@/data/goals';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { dec, parseTypedAmount, toTypedText } from '@/lib/money';
import { useAction } from '@/state/actions';
import { goBack } from '@/state/nav';
import { usePlan } from '@/state/plan';
import { useSettings } from '@/state/settings';
import { fonts, radius, useTheme } from '@/theme';

/** Add savings goal / Edit goal: a name, one currency, a target. */
export function GoalForm({ goal }: { goal?: Goal }) {
  const s = strings.goals;
  const { colors } = useTheme();
  const settings = useSettings();
  const plan = usePlan();
  const action = useAction({ itemName: goal?.name });
  const [name, setName] = useState(goal?.name ?? '');
  const [currency, setCurrency] = useState(goal?.currency ?? settings.defaultCurrency);
  const [targetText, setTargetText] = useState(goal ? toTypedText(goal.targetAmount, settings.numberFormat) : '');
  const [sheet, setSheet] = useState<'currency' | 'delete' | null>(null);
  const target = parseTypedAmount(targetText, settings.numberFormat);
  const currencyLocked = !!goal && dec(goalTotal(db, goal.id)).gt(0);
  const canSave = name.trim() !== '' && !!target && dec(target).gt(0);

  const save = () => {
    if (!canSave) return;
    const ok = action.run(() => (goal ? (updateGoal(db, goal.id, { name, target: target! }), goal.id) : createGoal(db, { name, currency, target: target! }, plan)));
    if (ok) goBack();
  };

  return (
    <Screen>
      <Header title={goal ? s.edit : s.add} onBack={goBack} backIcon="close" actions={<IconButton icon="tick" filled label={s.save} onPress={save} disabled={!canSave} />} />
      {action.ui}
      <Field label={s.name} value={name} onChangeText={setName} placeholder={s.namePlaceholder} />
      <SelectorRow label={s.currency.toUpperCase()} value={currency} onPress={currencyLocked || goal ? undefined : () => setSheet('currency')} />
      <Hint>{s.currencyHint}</Hint>
      <View>
        <Text style={[styles.label, { color: colors.inkMuted }]}>{s.target}</Text>
        <View style={[styles.amountBox, { backgroundColor: colors.filled }]}>
          <Text style={[styles.code, { color: colors.inkSecondary }]}>{currency}</Text>
          <TextInput value={targetText} onChangeText={setTargetText} keyboardType="numeric" placeholder="0.00" placeholderTextColor={colors.inkMuted} style={[styles.amountInput, { color: colors.ink }]} />
        </View>
      </View>
      <Button label={s.save} disabled={!canSave} onPress={save} />
      {goal ? <LinkButton danger label={s.delete} onPress={() => setSheet('delete')} /> : null}

      <CurrencySheet visible={sheet === 'currency'} selected={currency} onSelect={setCurrency} onClose={() => setSheet(null)} />
      <BottomSheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title={goal ? s.deleteTitle(goal.name) : ''}>
        <View style={{ gap: 12 }}>
          <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.deleteBody}</Text>
          <Button
            label={s.delete}
            style={{ backgroundColor: colors.expense }}
            onPress={() => {
              if (goal && action.run(() => (deleteGoal(db, goal.id), true))) router.dismissTo('/savings');
            }}
          />
          <Button kind="secondary" label={strings.common.cancel} onPress={() => setSheet(null)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 5 },
  amountBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.field, paddingHorizontal: 14 },
  code: { fontFamily: fonts.sansBold, fontSize: 11 },
  amountInput: { flex: 1, fontFamily: fonts.mono, fontSize: 20, paddingVertical: 10 },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
});
