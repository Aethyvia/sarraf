import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Keypad } from '@/components/Keypad';
import { expressionValue, pressKey, type CalcKey } from '@/lib/calc';
import { useTheme } from '@/theme';

/**
 * A full page with an amount (pattern A, Owner Nov 12): the header and rows on
 * top (scrolling), the amount box and Sarraf's keypad docked at the bottom,
 * like Add transaction. While the phone keyboard is up (typing a name) the
 * keypad steps aside; tapping the amount brings it back.
 */
export function KeypadScreen({
  header,
  children,
  amount,
  onKey,
  keypad = true,
}: {
  header: ReactNode;
  children: ReactNode;
  /** The amount box(es) and any line under them, docked above the keypad. */
  amount: ReactNode;
  onKey: (key: CalcKey) => void;
  /** False hides the dock entirely (e.g. "Amount varies"). */
  keypad?: boolean;
}) {
  const { colors } = useTheme();
  const keyboard = useKeyboardVisible();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <View style={styles.top}>{header}</View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.rows} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {keypad ? (
        <View style={styles.bottom}>
          {amount}
          {keyboard ? null : <Keypad onKey={onKey} />}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** True while the phone keyboard is showing. */
export function useKeyboardVisible(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return shown;
}

/** One amount typed on the keypad: the expression, its value, and the key handler. */
export function useAmountField(initial: string, maxDecimals: number) {
  const [expression, setExpression] = useState(initial);
  return {
    expression,
    value: expressionValue(expression, maxDecimals),
    set: setExpression,
    press: (key: CalcKey) => {
      Keyboard.dismiss();
      setExpression((e) => pressKey(e, key, maxDecimals));
    },
    back: () => setExpression((e) => pressKey(e, 'back')),
    clear: () => setExpression(''),
  };
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  rows: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 10 },
  bottom: { paddingHorizontal: 16, paddingBottom: 10, paddingTop: 6, gap: 8 },
});
