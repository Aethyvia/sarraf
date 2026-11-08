import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { useSettings } from '@/state/settings';
import { fonts, useTheme } from '@/theme';

const HEIGHT = 110;

/** Income and spending per month as two lines (Analytics' monthly trend). Hidden with Hide amounts. */
export function TrendLines({ months, income, spending, labels }: { months: string[]; income: number[]; spending: number[]; labels: string[] }) {
  const { colors } = useTheme();
  const { hideAmounts } = useSettings();
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...income, ...spending);
  const x = (i: number) => (months.length > 1 ? 8 + (i * (width - 16)) / (months.length - 1) : width / 2);
  const y = (v: number) => HEIGHT - 10 - (v / max) * (HEIGHT - 20);
  const line = (vs: number[]) => vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <View>
      <View style={{ height: HEIGHT }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            {[10, HEIGHT / 2, HEIGHT - 10].map((gy) => (
              <Line key={gy} x1={0} y1={gy} x2={width} y2={gy} stroke={colors.line} />
            ))}
            {!hideAmounts ? (
              <>
                <Polyline points={line(income)} fill="none" stroke={colors.income} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                <Polyline points={line(spending)} fill="none" stroke={colors.expense} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                <Circle cx={x(months.length - 1)} cy={y(income[income.length - 1] ?? 0)} r={4} fill={colors.income} />
                <Circle cx={x(months.length - 1)} cy={y(spending[spending.length - 1] ?? 0)} r={4} fill={colors.expense} />
              </>
            ) : null}
          </Svg>
        ) : null}
      </View>
      <View style={styles.labels}>
        {labels.map((l) => (
          <Text key={l} style={[styles.label, { color: colors.inkMuted }]}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  label: { fontFamily: fonts.sans, fontSize: 10.5 },
});
