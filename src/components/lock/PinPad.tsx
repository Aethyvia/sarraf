import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { strings } from '@/i18n/strings';
import { fonts, useTheme } from '@/theme';

/** PIN dots: filled as digits are entered; red after a wrong PIN. */
export function PinDots({ length, filled, error }: { length: number; filled: number; error?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.dots} accessibilityLabel={`${filled} of ${length} digits`}>
      {Array.from({ length }, (_, i) => {
        const on = error || i < filled;
        const c = error ? colors.expense : colors.accent;
        return <View key={i} style={[styles.dot, { borderColor: on ? c : colors.border, backgroundColor: on ? c : 'transparent' }]} />;
      })}
    </View>
  );
}

/** The round number pad (Create PIN, Lock screen). An optional fingerprint key sits bottom-left. */
export function PinPad({ onDigit, onDelete, onBiometric, disabled }: { onDigit: (d: string) => void; onDelete: () => void; onBiometric?: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const key = (d: string) => (
    <Pressable
      key={d}
      disabled={disabled}
      onPress={() => onDigit(d)}
      accessibilityRole="button"
      accessibilityLabel={d}
      style={({ pressed }) => [styles.key, { backgroundColor: colors.filled }, pressed && { opacity: 0.6 }, disabled && { opacity: 0.4 }]}
    >
      <Text style={[styles.digit, { color: colors.ink }]}>{d}</Text>
    </Pressable>
  );
  return (
    <View style={styles.grid}>
      {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((row) => (
        <View key={row[0]} style={styles.row}>
          {row.map(key)}
        </View>
      ))}
      <View style={styles.row}>
        {onBiometric ? (
          <Pressable onPress={onBiometric} accessibilityRole="button" accessibilityLabel={strings.lock.useBiometrics} style={[styles.key, { backgroundColor: colors.accentSoft }]}>
            <Icon name="lock" size={24} color={colors.accent} strokeWidth={1.8} />
          </Pressable>
        ) : (
          <View style={styles.key} />
        )}
        {key('0')}
        <Pressable onPress={onDelete} disabled={disabled} accessibilityRole="button" accessibilityLabel={strings.lock.delete} style={styles.key}>
          <Icon name="backspace" size={24} color={colors.ink} strokeWidth={1.8} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginVertical: 14 },
  dot: { width: 14, height: 14, borderRadius: 999, borderWidth: 2 },
  grid: { gap: 14 },
  row: { flexDirection: 'row', gap: 22 },
  key: { flex: 1, height: 64, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  digit: { fontFamily: fonts.mono, fontSize: 24 },
});
