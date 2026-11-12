import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { ruleText } from '@/components/forms/RecurringForm';
import { Button, IconChip } from '@/components/ui';
import { canPayInOneTap, payRecurring, type RecurringItem, type RepeatRule } from '@/data/recurring';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { useAction } from '@/state/actions';
import { useToast } from '@/state/toast';
import { BUTTON_HEIGHT, fonts, radius, useTheme } from '@/theme';

/**
 * A recurring item (Spec §8, §12). On Home: same-amount items get Paid
 * (expenses) or Received; bills get Add, which opens Add transaction; auto-add
 * items show an Auto tag. In the list, it shows its schedule and opens Edit.
 */
export function RecurringRow({
  item,
  variant,
  last,
  onSkip,
  category,
  buttonStyle,
}: {
  item: RecurringItem;
  /** home: a card with an icon; review: a plain row in Review's card; list: the Recurring list. */
  variant: 'home' | 'review' | 'list';
  last?: boolean;
  onSkip?: () => void;
  /** Review sizes every action the same. */
  buttonStyle?: object;
  /** Its category's look: on Home a fixed payment shows a repeat icon in its colour, a bill its icon. */
  category?: { icon: string; color: string } | null;
}) {
  const s = strings.recurring;
  const { colors } = useTheme();
  const toast = useToast();
  const action = useAction({ itemName: item.name });
  const varies = item.amountType === 'varies';
  const due = formatShortDate(item.nextDueDate);
  const home = variant === 'home';
  const money = (v: string) => <Money value={v} currency={item.currency} style={[home ? styles.detail : styles.detailMoney, { color: colors.inkMuted }]} />;

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
      <AutoTag />
    ) : varies ? (
      <Button label={s.addBill} onPress={open} style={[styles.button, buttonStyle]} />
    ) : (
      <Button
        label={item.kind === 'expense' ? s.paid : s.received}
        style={[styles.button, buttonStyle]}
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
      style={({ pressed }) => [
        styles.row,
        home ? [styles.card, { backgroundColor: colors.surface }] : !last && { borderBottomWidth: 1, borderBottomColor: colors.line },
        pressed && { backgroundColor: colors.filled },
      ]}
    >
      {home ? <IconChip icon={varies ? (category?.icon ?? 'repeat') : 'repeat'} color={category?.color ?? 'neutral'} size={40} /> : null}
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

/** Home's "Auto" marker: the same shape and size as the Paid / Add buttons beside it, but not a button. */
export function AutoTag() {
  const { colors } = useTheme();
  return (
    <View style={[styles.autoTag, { backgroundColor: colors.filled }]} accessibilityLabel={strings.recurring.auto}>
      <Text style={[styles.autoText, { color: colors.inkSecondary }]}>{strings.recurring.auto}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  autoTag: { height: BUTTON_HEIGHT, minWidth: 64, paddingHorizontal: 14, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  autoText: { fontFamily: fonts.sansBold, fontSize: 13.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, minHeight: 60 },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  detail: { fontFamily: fonts.sans, fontSize: 12 },
  detailMoney: { fontFamily: fonts.mono, fontSize: 12 },
  tag: { fontFamily: fonts.sansBold, fontSize: 10.5, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden' },
  skip: { fontFamily: fonts.sansBold, fontSize: 11.5, marginTop: 4, alignSelf: 'flex-start' },
  card: { borderRadius: 14, padding: 12, gap: 12, minHeight: 0 },
  button: { paddingHorizontal: 14, minWidth: 64 },
});
