import { router } from 'expo-router';
import { useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';

import { AmountBox } from '@/components/AmountBox';
import { KeypadScreen, useAmountField } from '@/components/KeypadScreen';
import { CurrencySheet } from '@/components/sheets/CurrencySheet';
import { BottomSheet, Button, Field, Header, Hint, IconButton, LinkButton } from '@/components/ui';
import { createGoal, deleteGoal, goalTotal, updateGoal, type Goal } from '@/data/goals';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { dec, getCurrency } from '@/lib/money';
import { useAction } from '@/state/actions';
import { goBack } from '@/state/nav';
import { usePlan } from '@/state/plan';
import { useSettings } from '@/state/settings';
import { fonts, useTheme } from '@/theme';

/** Add savings goal / Edit goal: a name, one currency, a target. */
export function GoalForm({ goal }: { goal?: Goal }) {
  const s = strings.goals;
  const { colors } = useTheme();
  const settings = useSettings();
  const plan = usePlan();
  const action = useAction({ itemName: goal?.name });
  const [name, setName] = useState(goal?.name ?? '');
  const [currency, setCurrency] = useState(goal?.currency ?? settings.defaultCurrency);
  const [sheet, setSheet] = useState<'currency' | 'delete' | null>(null);
  // The target is typed on Sarraf's keypad (pattern A); the chip in its box is the one place to pick the currency (Owner, Nov 12).
  const field = useAmountField(goal?.targetAmount ?? '', getCurrency(currency).minorUnits);
  const target = field.value;
  const currencyLocked = !!goal && dec(goalTotal(db, goal.id)).gt(0);
  const canSave = name.trim() !== '' && !!target && dec(target).gt(0);

  const save = () => {
    if (!canSave) return;
    const ok = action.run(() => (goal ? (updateGoal(db, goal.id, { name, target: target! }), goal.id) : createGoal(db, { name, currency, target: target! }, plan)));
    if (ok) goBack();
  };

  return (
    <KeypadScreen
      header={
        <>
          <Header title={goal ? s.edit : s.add} onBack={goBack} backIcon="close" actions={<IconButton icon="tick" filled label={s.save} onPress={save} disabled={!canSave} />} />
          {action.ui}
        </>
      }
      onKey={field.press}
      amount={
        <AmountBox
          label={s.target.toUpperCase()}
          expression={field.expression}
          value={field.value}
          currency={currency}
          onCurrency={currencyLocked || goal ? undefined : () => (Keyboard.dismiss(), setSheet('currency'))}
          onBackspace={field.back}
          onClear={field.clear}
        />
      }
    >
      <Field label={s.name} value={name} onChangeText={setName} placeholder={s.namePlaceholder} />
      <Hint>{s.currencyHint}</Hint>
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
    </KeypadScreen>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
});
