import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

import { BottomSheet, Button, ToggleRow } from '@/components/ui';
import type { people } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { today as todayDate } from '@/lib/dates';
import { shareSummaryText, type ShareLine } from '@/data/share-summary';
import { useSettings } from '@/state/settings';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';

/** Share with a person: their balances as plain text, for WhatsApp or SMS. */
export function ShareSummarySheet({
  visible,
  person,
  balances,
  history,
  onClose,
}: {
  visible: boolean;
  person: typeof people.$inferSelect;
  balances: { currency: string; balance: string }[];
  history: ShareLine[];
  onClose: () => void;
}) {
  const s = strings.shareSummary;
  const { colors } = useTheme();
  const { numberFormat, hideAmounts } = useSettings();
  const toast = useToast();
  const [includeLast, setIncludeLast] = useState(false);
  const options = { date: todayDate(), numberFormat, includeLast };
  const text = shareSummaryText(person.name, balances, history, options);
  // Hide amounts covers the preview too; the text sent is the real one, since sending it is a choice to show it.
  const preview = shareSummaryText(person.name, balances, history, { ...options, hidden: hideAmounts });
  return (
    <BottomSheet visible={visible} onClose={onClose} title={s.title(person.name)}>
      <View style={{ gap: 12 }}>
        <Text style={[styles.preview, { backgroundColor: colors.filled, color: colors.ink }]}>{preview}</Text>
        <ToggleRow title={s.includeLast} value={includeLast} onChange={setIncludeLast} />
        <View style={styles.buttons}>
          <Button label={s.share} style={{ flex: 1.4 }} onPress={() => Share.share({ message: text })} />
          <Button
            kind="secondary"
            label={s.copy}
            style={{ flex: 1 }}
            onPress={async () => {
              await Clipboard.setStringAsync(text);
              toast({ message: s.copied });
            }}
          />
        </View>
        <Text style={[styles.note, { color: colors.inkMuted }]}>{s.note}</Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  preview: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, borderRadius: radius.field, padding: 14 },
  buttons: { flexDirection: 'row', gap: 10 },
  note: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
});
