import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { sharesKeptByRefund } from '@/data/owing';
import { strings } from '@/i18n/strings';
import { useLive } from '@/state/live';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Next to a refund on a split you paid: each person's share stays as split
 * (Decided Nov 8), with their live balance and a way to edit the split.
 */
export function SharesKeptNote({ expenseId }: { expenseId: string }) {
  const { colors } = useTheme();
  const kept = useLive((d) => sharesKeptByRefund(d, expenseId), [expenseId]);
  if (!kept.length) return null;
  const money = (v: string, c: string, sign: 'auto' | 'always' = 'auto') => <Money value={v} currency={c} sign={sign} allowCompact={false} style={styles.mono} />;
  return (
    <View style={[styles.note, { backgroundColor: colors.filled }]}>
      {kept.map((k) => (
        <Text key={k.personId} style={[styles.text, { color: colors.inkSecondary }]}>
          {parts(strings.moneyBack.shareKept(k.name, money(k.share, k.currency), money(k.balance, k.currency, 'always')))}
        </Text>
      ))}
      <Text onPress={() => router.push(`/transaction/${expenseId}/edit`)} accessibilityRole="button" style={[styles.link, { color: colors.accent }]}>
        {strings.moneyBack.editSplit}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { borderRadius: radius.field, padding: 12, gap: 4 },
  text: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  mono: { fontFamily: fonts.monoSemiBold, fontSize: 12 },
  link: { fontFamily: fonts.sansBold, fontSize: 12.5, marginTop: 2 },
});
