import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { ruleText } from '@/components/forms/RecurringForm';
import { Button } from '@/components/ui';
import { canPayInOneTap, payRecurring, type RecurringItem, type RepeatRule } from '@/data/recurring';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { useAction } from '@/state/actions';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';

/**
 * A recurring item (Spec §8, §12). On Home: same-amount items get Paid
 * (expenses) or Received; bills get Add, which opens Add transaction; auto-add
 * items show an Auto tag. In the list, it shows its schedule and opens Edit.
 */
export function RecurringRow({ item, variant, last, onSkip }: { item: RecurringItem; variant: 'home' | 'list'; last?: boolean; onSkip?: () => void }) {
  const s = strings.recurring;
  const { colors } = useTheme();
  const toast = useToast();
  const action = useAction({ itemName: item.name });
  const varies = item.amountType === 'varies';
  const due = formatShortDate(item.nextDueDate);
  const money = (v: string) => <Money value={v} currency={item.currency} style={[styles.detailMoney, { color: colors.inkMuted }]} />;

  const detail = varies
    ? item.lastAmount
      ? parts(s.usually(money(item.lastAmount), due))
      : s.variesDue(due)
    : parts([money(item.amount!), ` · ${variant === 'list' ? ruleText(item.repeatRule as RepeatRule) : s.next(due)}`]);

  const open = () => router.push({ pathname: '/transaction/new', params: { recurring: item.id } });
  const trailing =
    variant === 'list' ? (
      !item.active ? (
        <Text style={[styles.tag, { color: colors.inkMuted, backgroundColor: colors.filled }]}>{s.paused}</Text>
      ) : item.autoAdd ? (
        <Text style={[styles.tag, { color: colors.inkSecondary, backgroundColor: colors.filled }]}>{s.auto}</Text>
      ) : null
    ) : item.autoAdd ? (
      <Text style={[styles.tag, { color: colors.inkSecondary, backgroundColor: colors.filled }]}>{s.auto}</Text>
    ) : varies ? (
      <Button label={s.addBill} onPress={open} style={styles.button} />
    ) : (
      <Button
        label={item.kind === 'expense' ? s.paid : s.received}
        style={styles.button}
        onPress={() => {
          // Same amount: one tap adds it, unless a transfer between currencies needs what arrived.
          if (!canPayInOneTap(db, item)) return open();
          if (action.run(() => payRecurring(db, item.id))) toast({ message: s.paidToast });
        }}
      />
    );

  return (
    <Pressable
      onPress={() => router.push(`/recurring/${item.id}/edit`)}
      style={({ pressed }) => [styles.row, !last && { borderBottomWidth: 1, borderBottomColor: colors.line }, pressed && { backgroundColor: colors.filled }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.title, { color: colors.ink }, !item.active && { color: colors.inkMuted }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.detail, { color: colors.inkMuted }]} numberOfLines={1}>
          {detail}
        </Text>
        {onSkip ? (
          <Text onPress={onSkip} accessibilityRole="button" style={[styles.skip, { color: colors.accent }]}>
            {s.skip}
          </Text>
        ) : null}
      </View>
      {trailing}
      {action.ui}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, minHeight: 60 },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  detail: { fontFamily: fonts.sans, fontSize: 12 },
  detailMoney: { fontFamily: fonts.mono, fontSize: 12 },
  tag: { fontFamily: fonts.sansBold, fontSize: 10.5, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden' },
  skip: { fontFamily: fonts.sansBold, fontSize: 11.5, marginTop: 4, alignSelf: 'flex-start' },
  button: { paddingHorizontal: 16, minWidth: 72 },
});
