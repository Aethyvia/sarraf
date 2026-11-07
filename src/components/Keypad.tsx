import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import type { CalcKey } from '@/lib/calc';
import { fonts, useTheme } from '@/theme';

const ROWS: CalcKey[][] = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '−'],
  ['.', '0', '=', '+'],
];
const OPERATORS = new Set<CalcKey>(['÷', '×', '−', '+']);

/**
 * The calculator keypad for amounts (no system keyboard): digits, operators
 * and =. Long-press = to clear.
 */
export function Keypad({ onKey }: { onKey: (key: CalcKey) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid}>
      {ROWS.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((key) => {
            const equals = key === '=';
            const op = OPERATORS.has(key);
            return (
              <Pressable
                key={key}
                onPress={() => onKey(key)}
                onLongPress={equals ? () => onKey('clear') : undefined}
                accessibilityRole="button"
                accessibilityLabel={key === '.' ? 'point' : key}
                style={({ pressed }) => [
                  styles.key,
                  { backgroundColor: equals ? colors.accent : colors.filled },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.keyText, { color: equals ? colors.onAccent : op ? colors.accent : colors.ink }, (op || equals) && styles.opText]}>{key}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** A backspace button for the amount card. */
export function BackspaceButton({ onPress, onLongPress }: { onPress: () => void; onLongPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} hitSlop={10} accessibilityRole="button" accessibilityLabel="Delete" style={styles.back}>
      <Icon name="back" size={18} color={colors.inkMuted} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 7 },
  row: { flexDirection: 'row', gap: 7 },
  key: { flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontFamily: fonts.monoSemiBold, fontSize: 17 },
  opText: { fontFamily: fonts.monoSemiBold, fontSize: 18 },
  back: { padding: 4 },
});
