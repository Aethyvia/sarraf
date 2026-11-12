import { StyleSheet, View } from 'react-native';

import { radius, useTheme } from '@/theme';

/** A thin progress bar (backup, restore, setup steps). `value` is 0–1. */
export function ProgressBar({ value, height = 6 }: { value: number; height?: number }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={[styles.track, { height, backgroundColor: colors.accentSoft }]}
    >
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderRadius: radius.pill, overflow: 'hidden', width: '100%' },
  fill: { height: '100%', borderRadius: radius.pill },
});
