import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { BottomSheet, Button, Card, LinkButton } from '@/components/ui';
import { cancelTransaction } from '@/data/review';
import type { TransactionRow } from '@/data/transactions';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { fonts, useTheme } from '@/theme';

/** While you were away (Decided Nov 7): what was auto-added for missed due dates since the app was last open. */
export function AwaySheet({ added, accountName }: { added: TransactionRow[]; accountName: (id: string | null) => string }) {
  const s = strings.recurring;
  const { colors } = useTheme();
  const [open, setOpen] = useState(added.length > 0);
  const close = () => setOpen(false);
  return (
    <BottomSheet visible={open} onClose={close} title={s.awayTitle(added.length)}>
      <View style={{ gap: 12 }}>
        <Text style={[styles.body, { color: colors.inkSecondary, marginTop: -6 }]}>{s.awayBody}</Text>
        <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          {added.map((t, i) => (
            <View key={t.id} style={[styles.row, i < added.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.ink }]}>{t.notes?.split('\n')[0] ?? strings.recurring.title}</Text>
                <Text style={[styles.small, { color: colors.inkMuted }]}>{[formatShortDate(t.date), accountName(t.accountId), s.auto].join(' · ')}</Text>
              </View>
              <Money value={t.kind === 'expense' ? `-${t.amount}` : t.amount} currency={t.currency} style={[styles.amount, { color: t.kind === 'expense' ? colors.expense : t.kind === 'income' ? colors.income : colors.ink }]} />
            </View>
          ))}
        </Card>
        <Text style={[styles.small, { color: colors.inkMuted }]}>{s.awayNote}</Text>
        <Button
          label={s.review}
          onPress={() => {
            close();
            router.push('/review');
          }}
        />
        <LinkButton
          danger
          label={s.cancelAll(added.length)}
          onPress={() => {
            for (const t of added) cancelTransaction(db, t.id);
            close();
          }}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
  amount: { fontSize: 14 },
});
