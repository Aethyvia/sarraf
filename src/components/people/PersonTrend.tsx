import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';

import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme';

const HEIGHT = 28;

/** A person's small balance trend: a dashed zero line, then the balance after each change. Hidden with Hide amounts. */
export function PersonTrend({ points, color }: { points: number[]; color: string }) {
  const { colors } = useTheme();
  const { hideAmounts } = useSettings();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  // Starts from zero, so the first step shows.
  const values = [0, ...points];
  const max = Math.max(...values.map(Math.abs)) || 1;
  const y = (v: number) => HEIGHT / 2 - (v / max) * (HEIGHT / 2 - 2);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const line = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <View onLayout={onLayout} style={{ height: HEIGHT }}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          <Line x1={0} y1={HEIGHT / 2} x2={width} y2={HEIGHT / 2} stroke={colors.border} strokeDasharray="3 3" />
          {!hideAmounts ? <Polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
        </Svg>
      ) : null}
    </View>
  );
}
