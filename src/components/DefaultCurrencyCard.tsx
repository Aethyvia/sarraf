import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import type { CurrencyTile } from '@/data/home';
import { strings } from '@/i18n/strings';
import { dec, toDecimalString } from '@/lib/money';
import { useSettings } from '@/state/settings';
import { fonts, useTheme } from '@/theme';

const CHART_HEIGHT = 56;

/**
 * Home's first tile (owner, Nov 20; canvas "Home G"): the default currency,
 * full width — balance, a 30-day balance trend, then In, Out and Usable.
 * White card in light theme, the usual tile colour in dark. Opens that currency's accounts.
 */
export function DefaultCurrencyCard({ tile, trend }: { tile: CurrencyTile; trend: string[] }) {
  const s = strings.home;
  const { colors } = useTheme();
  const negative = dec(tile.usable).isNegative();
  const red = (v: string) => <Money value={v} currency={tile.currency} style={[styles.label, { color: colors.expense, fontFamily: fonts.monoSemiBold }]} />;
  return (
    <Pressable
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface }, pressed && { opacity: 0.85 }]}
      onPress={() => router.push({ pathname: '/accounts', params: { currency: tile.currency } })}
      accessibilityRole="button"
    >
      <View style={styles.top}>
        <Text style={[styles.code, { color: colors.inkSecondary }]}>{s.defaultTile(tile.currency)}</Text>
        <Text style={[styles.label, { color: colors.inkSecondary }]}>{s.trendDays}</Text>
      </View>
      <Money value={tile.balance} currency={tile.currency} style={[styles.balance, { color: colors.ink }]} />
      <TrendLine values={trend} />
      <View style={[styles.stats, { borderTopColor: colors.line }]}>
        <View style={styles.stat}>
          <Text style={[styles.label, { color: colors.inkSecondary }]}>{s.in}</Text>
          <Money value={tile.in} currency={tile.currency} sign="always" style={[styles.statValue, { color: colors.income }]} />
        </View>
        <View style={styles.stat}>
          <Text style={[styles.label, { color: colors.inkSecondary }]}>{s.out}</Text>
          <Money value={tile.out} currency={tile.currency} sign="minus" style={[styles.statValue, { color: colors.expense }]} />
        </View>
        <View style={styles.stat}>
          <Text style={[styles.label, { color: colors.inkSecondary }]}>{s.usable}</Text>
          <Money value={tile.usable} currency={tile.currency} style={[styles.statValue, { color: negative ? colors.expense : colors.ink }]} />
        </View>
      </View>
      {negative && dec(tile.setAside).gt(0) ? (
        <Text style={[styles.label, { color: colors.expense }]}>
          {parts(strings.goals.overBalance(red(toDecimalString(dec(tile.usable).abs())), red(tile.setAside), tile.currency))}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The balance over the last 30 days: a line over a soft fill, a dot on today. Hidden with Hide amounts, like other charts. */
function TrendLine({ values }: { values: string[] }) {
  const { colors } = useTheme();
  const { hideAmounts } = useSettings();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const nums = values.map(Number);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const pad = 5;
  const y = (v: number) => (max === min ? CHART_HEIGHT / 2 : pad + ((max - v) / (max - min)) * (CHART_HEIGHT - pad * 2));
  const step = nums.length > 1 ? (width - pad * 2) / (nums.length - 1) : 0;
  const pts = nums.map((v, i) => [pad + i * step, y(v)] as const);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <View onLayout={onLayout} style={{ height: CHART_HEIGHT }} accessible accessibilityLabel={strings.home.trendLabel}>
      {width > 0 && pts.length > 1 ? (
        <Svg width={width} height={CHART_HEIGHT}>
          {hideAmounts ? (
            <Line x1={0} y1={CHART_HEIGHT / 2} x2={width} y2={CHART_HEIGHT / 2} stroke={colors.border} strokeDasharray="3 3" />
          ) : (
            <>
              <Path d={`${line} L${last[0].toFixed(1)} ${CHART_HEIGHT} L${pad} ${CHART_HEIGHT} Z`} fill={colors.trend} fillOpacity={0.13} />
              <Path d={line} fill="none" stroke={colors.trend} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
              <Circle cx={last[0]} cy={last[1]} r={4} fill={colors.trend} />
            </>
          )}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', borderRadius: 22, padding: 16, gap: 8, elevation: 3 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  code: { fontFamily: fonts.sansExtraBold, fontSize: 11, letterSpacing: 0.7 },
  balance: { fontFamily: fonts.monoSemiBold, fontSize: 32, letterSpacing: -0.5 },
  stats: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 8, gap: 6 },
  stat: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.sans, fontSize: 11 },
  statValue: { fontFamily: fonts.monoSemiBold, fontSize: 12.5 },
});
