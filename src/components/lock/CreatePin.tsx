import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton, LinkButton } from '@/components/ui';
import { isEasyPin } from '@/data/app-lock';
import { strings } from '@/i18n/strings';
import { fonts, useTheme } from '@/theme';
import { PinDots, PinPad } from './PinPad';

/** Create PIN (board): enter, then enter again. 4 digits by default; "Use 6 digits instead". */
export function CreatePin({ title, onDone, onClose }: { title?: string; onDone: (pin: string, length: 4 | 6) => void; onClose?: () => void }) {
  const s = strings.lock;
  const { colors } = useTheme();
  const [length, setLength] = useState<4 | 6>(4);
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const digit = (d: string) => {
    const next = pin + d;
    setNote(null);
    if (next.length < length) return setPin(next);
    if (first === null) {
      if (isEasyPin(next)) {
        setPin('');
        return setNote(s.tooEasy);
      }
      setFirst(next);
      return setPin('');
    }
    if (next !== first) {
      setFirst(null);
      setPin('');
      return setNote(s.mismatch);
    }
    onDone(next, length);
  };

  return (
    <SafeAreaView style={[styles.wrap, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {onClose ? <IconButton icon="close" label={strings.common.close} onPress={onClose} /> : <View style={{ height: 44 }} />}
      <View style={{ alignItems: 'center', gap: 6, marginTop: 18 }}>
        <Text style={[styles.title, { color: colors.ink }]}>{first === null ? (title ?? s.createTitle) : s.confirmTitle}</Text>
        <Text style={[styles.body, { color: colors.inkSecondary }]}>{first === null ? s.createBody(length) : s.confirmBody}</Text>
      </View>
      <PinDots length={length} filled={pin.length} />
      <Text style={[styles.small, { color: note ? colors.expense : colors.inkMuted }]}>{note ?? s.easy}</Text>
      {first === null ? (
        <LinkButton
          label={length === 4 ? s.useSix : s.useFour}
          onPress={() => {
            setLength(length === 4 ? 6 : 4);
            setPin('');
          }}
        />
      ) : null}
      <View style={{ flex: 1 }} />
      <PinPad onDigit={digit} onDelete={() => setPin((p) => p.slice(0, -1))} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 28, paddingTop: 20, paddingBottom: 28, gap: 12 },
  title: { fontFamily: fonts.serif, fontSize: 22 },
  body: { fontFamily: fonts.sans, fontSize: 13, textAlign: 'center' },
  small: { fontFamily: fonts.sans, fontSize: 12, textAlign: 'center' },
});
