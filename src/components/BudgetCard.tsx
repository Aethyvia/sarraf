import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { IconChip } from '@/components/ui';
import type { BudgetStatus } from '@/data/budgets';
import { strings } from '@/i18n/strings';
import { dec, toDecimalString } from '@/lib/money';
import { fonts, radius, useTheme } from '@/theme';

/** One budget: spent of its cap, a bar, and OVER (+amount) when past it. */
export function BudgetCard({
  status,
  category,
  compact,
  wholeLabel,
}: {
  status: BudgetStatus;
  category?: { name: string; icon: string; color: string } | null;
  compact?: boolean;
  /** The whole-ledger card's label; "WHOLE LEDGER · USD" by default. */
  wholeLabel?: string;
}) {
  const s = strings.budgets;
  const { colors } = useTheme();
  const { budget, spent, left, percent, over } = status;
  const money = (v: string, color: string, size = 14) => <Money value={v} currency={budget.currency} allowCompact={false} style={[styles.mono, { color, fontSize: size }]} />;
  const overBy = (size: number) => (
    <Text style={[styles.mono, { color: colors.warning, fontSize: size }]}>
      {parts(s.overBy(<Money value={toDecimalString(dec(left).abs())} currency={budget.currency} sign="always" allowCompact={false} style={[styles.mono, { color: colors.warning, fontSize: size }]} />))}
    </Text>
  );
  if (compact) {
    // Home (board "Home"): one line — chip, name, then "+$4.00 over" or spent / cap — and the bar.
    return (
      <Pressable
        onPress={() => router.push(`/budgets/${budget.id}`)}
        style={[
          styles.compact,
          { backgroundColor: over ? colors.warningTint : colors.surface, borderColor: over ? colors.warningSoft : 'transparent' },
          !over && styles.shadow,
        ]}
      >
        <View style={styles.top}>
          {category ? <IconChip icon={category.icon} color={category.color} size={28} /> : null}
          <Text style={[styles.name, styles.compactName, { color: colors.ink }]} numberOfLines={1}>
            {category?.name ?? s.allSpending}
          </Text>
          {over ? (
            overBy(12)
          ) : (
            <Text style={{ fontSize: 12.5 }}>
              {money(spent, colors.ink, 12.5)}
              <Text style={{ color: colors.inkMuted }}> / </Text>
              {money(budget.amount, colors.inkMuted, 12.5)}
            </Text>
          )}
        </View>
        <View style={[styles.track, { backgroundColor: colors.filled }]}>
          <View style={[styles.fill, { width: `${Math.min(100, percent)}%`, backgroundColor: over ? colors.overBar : colors.inkSecondary }]} />
        </View>
      </Pressable>
    );
  }
  const tag = over ? (
    <Text style={[styles.overTag, { color: colors.warning, borderColor: colors.warningLine }]}>{s.over}</Text>
  ) : (
    <Text style={[styles.pct, { color: colors.inkMuted }]}>{percent}%</Text>
  );
  const amounts = (
    <Text>
      {money(spent, colors.ink)}
      <Text style={{ color: colors.inkMuted }}> / </Text>
      {money(budget.amount, colors.inkMuted)}
    </Text>
  );
  return (
    <Pressable
      onPress={() => router.push(`/budgets/${budget.id}`)}
      style={[
        styles.card,
        over
          ? { backgroundColor: colors.warningTint, borderColor: colors.warningSoft, borderWidth: 1.5 }
          : category
            ? [{ backgroundColor: colors.surface }, styles.shadow]
            : { backgroundColor: colors.surface, borderColor: colors.outline, borderWidth: 1 },
      ]}
    >
      {category ? (
        <>
          <View style={[styles.top, { marginBottom: 2 }]}>
            <IconChip icon={category.icon} color={category.color} size={34} />
            <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
              {category.name}
            </Text>
            {tag}
          </View>
          <View style={styles.amounts}>
            {amounts}
            {over ? (
              <Money value={toDecimalString(dec(left).abs())} currency={budget.currency} sign="always" allowCompact={false} style={[styles.mono, { color: colors.warning, fontSize: 12 }]} />
            ) : null}
          </View>
        </>
      ) : (
        <>
          {/* Whole ledger: its label sits inside the card (board "Budgets"). */}
          <View style={styles.amounts}>
            <Text style={[styles.wholeLabel, { color: colors.inkMuted }]}>{wholeLabel ?? s.wholeLedger(budget.currency)}</Text>
            {tag}
          </View>
          <View style={styles.amounts}>
            <Text style={[styles.name, { color: colors.ink }]}>{s.allSpending}</Text>
            {amounts}
          </View>
        </>
      )}
      <View style={[styles.track, { backgroundColor: colors.filled }]}>
        <View style={[styles.fill, { width: `${Math.min(100, percent)}%`, backgroundColor: over ? colors.overBar : colors.inkSecondary }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, paddingHorizontal: 16, paddingVertical: 15, gap: 8 },
  wholeLabel: { fontFamily: fonts.sansExtraBold, fontSize: 12, letterSpacing: 0.72 },
  compact: { borderRadius: radius.card, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 14, gap: 9 },
  compactName: { fontSize: 13.5 },
  shadow: { shadowColor: '#1E180C', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontFamily: fonts.sansSemiBold, fontSize: 15 },
  pct: { fontFamily: fonts.sans, fontSize: 12 },
  overTag: { fontFamily: fonts.sansBold, fontSize: 10, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 2, overflow: 'hidden' },
  amounts: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  mono: { fontFamily: fonts.mono, fontSize: 14 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
});
