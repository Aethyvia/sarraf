import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { BackspaceButton } from '@/components/Keypad';

/**
 * Every typed amount field (charges, budgets, goals, splits, settle, fix
 * balance…): the text input plus the same backspace button as Add
 * transaction's amount — tap deletes the last character, hold clears. The
 * button shows once something is typed.
 */
export const AmountTextInput = forwardRef<TextInput, TextInputProps & { wrapStyle?: StyleProp<ViewStyle>; small?: boolean }>(function AmountTextInput(
  { wrapStyle, small, ...props },
  ref,
) {
  const { value, onChangeText } = props;
  return (
    <View style={[styles.wrap, wrapStyle]}>
      <TextInput ref={ref} {...props} />
      {value ? <BackspaceButton small={small} onPress={() => onChangeText?.(value.slice(0, -1))} onLongPress={() => onChangeText?.('')} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexGrow: 1, flexShrink: 1 },
});
