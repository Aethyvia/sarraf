import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { BottomSheet, Card, Header, IconButton, Screen, SheetOption } from '@/components/ui';
import { moveCurrency } from '@/data/currency-order';
import { currencyTiles } from '@/data/home';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { useLive } from '@/state/live';
import { fonts, radius, useTheme } from '@/theme';

/** Reorder currencies: sets Home's tile order. Tap a rank number to move a currency to that position. */
export default function ReorderCurrenciesScreen() {
  const s = strings.currencies;
  const { colors } = useTheme();
  const tiles = useLive((d) => currencyTiles(d));
  const [moving, setMoving] = useState<string | null>(null);
  const order = tiles.map((t) => t.currency);
  return (
    <Screen>
      <Header
        title={s.reorder}
        onBack={() => router.back()}
        backIcon="close"
        actions={<IconButton icon="tick" filled label={strings.common.save} onPress={() => router.back()} />}
      />
      <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.reorderHint}</Text>
      <Card>
        {tiles.map((t, i) => (
          <View key={t.currency} style={[styles.item, i < tiles.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.code, { color: colors.ink }]}>{t.currency}</Text>
              <Money value={t.balance} currency={t.currency} style={[styles.balance, { color: colors.inkMuted }]} />
            </View>
            <Pressable
              onPress={() => setMoving(t.currency)}
              accessibilityRole="button"
              accessibilityLabel={s.moveTo(t.currency)}
              style={[styles.rank, { borderColor: moving === t.currency ? colors.warning : colors.border }]}
            >
              <Text style={[styles.rankText, { color: colors.ink }]}>{i + 1}</Text>
            </Pressable>
          </View>
        ))}
      </Card>
      <BottomSheet visible={moving !== null} onClose={() => setMoving(null)} title={moving ? s.moveTo(moving) : ''}>
        {order.map((_, i) => (
          <SheetOption
            key={i}
            title={s.position(i + 1)}
            selected={order[i] === moving}
            onPress={() => {
              if (moving) moveCurrency(db, order, moving, i);
              setMoving(null);
            }}
          />
        ))}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, paddingHorizontal: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  code: { fontFamily: fonts.sansSemiBold, fontSize: 14.5 },
  balance: { fontSize: 12 },
  rank: { width: 32, height: 32, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontFamily: fonts.monoSemiBold, fontSize: 12 },
});
