import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { useSettings } from '@/state/settings';
import { fonts, useTheme } from '@/theme';

const HEIGHT = 100;

/**
 * The balance as a step line: flat between movements, a step on each day money
 * moved. Hidden while "Hide amounts" is on, since its shape gives amounts away.
 * Days before the account existed are null: the axis still spans the whole
 * range (30D / 6M / 1Y), and the line starts on the account's first day.
 */
export function BalanceTrend({ points: all, labels }: { points: (number | null)[]; labels: [string, string, string] }) {
  const { colors } = useTheme();
  const { hideAmounts } = useSettings();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  let line = '';
  let area = '';
  let last = { x: 0, y: 0 };
  const start = all.findIndex((v) => v !== null);
  const points = start < 0 ? [] : (all.slice(start) as number[]);
  if (width > 0 && points.length > 0) {
    const min = Math.min(0, ...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const y = (v: number) => 4 + (1 - (v - min) / span) * (HEIGHT - 10);
    const step = all.length > 1 ? width / (all.length - 1) : width;
    const x0 = start * step;
    line = `M${x0.toFixed(1)},${y(points[0]).toFixed(1)}`;
    points.forEach((v, i) => {
      if (i === 0) return;
      const x = (x0 + i * step).toFixed(1);
      line += ` H${x} V${y(v).toFixed(1)}`;
    });
    if (all.length === 1) line += ` H${width}`;
    area = `${line} V${HEIGHT - 4} H${x0.toFixed(1)} Z`;
    last = { x: width, y: y(points[points.length - 1]) };
  }

  return (
    <View>
      <View onLayout={onLayout} style={{ height: HEIGHT }}>
        {width > 0 && !hideAmounts ? (
          <Svg width={width} height={HEIGHT}>
            <Line x1={0} y1={HEIGHT - 4} x2={width} y2={HEIGHT - 4} stroke={colors.line} />
            <Path d={area} fill={colors.accentSoft} opacity={0.6} />
            <Path d={line} fill="none" stroke={colors.accent} strokeWidth={2} strokeLinejoin="round" />
            <Circle cx={last.x - 4} cy={last.y} r={4} fill={colors.accent} stroke={colors.surface} strokeWidth={2} />
          </Svg>
        ) : null}
      </View>
      <View style={styles.labels}>
        {labels.map((l, i) => (
          <Text key={i} style={[styles.label, { color: colors.inkMuted }]}>
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
