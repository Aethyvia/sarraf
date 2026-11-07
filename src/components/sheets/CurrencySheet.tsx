import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet, SheetOption } from '@/components/ui';
import { currencyOrder } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { ALL_CURRENCIES, type CurrencyInfo } from '@/lib/money';
import { useLive } from '@/state/live';
import { fonts, radius, useTheme } from '@/theme';

type Row = { type: 'label'; text: string } | { type: 'currency'; info: CurrencyInfo };

/** "Your currencies" (Home tile order) first, then all currencies A–Z, with search. */
export function CurrencySheet({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected?: string | null;
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const yours = useLive((db) => db.select().from(currencyOrder).orderBy(currencyOrder.rank).all().map((r) => r.currency));

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (c: CurrencyInfo) => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
    const mine = yours.map((code) => ALL_CURRENCIES.find((c) => c.code === code)).filter((c): c is CurrencyInfo => !!c && match(c));
    const all = ALL_CURRENCIES.filter(match);
    return [
      ...(mine.length ? [{ type: 'label', text: strings.currencyPicker.yours } as Row, ...mine.map((info) => ({ type: 'currency', info }) as Row)] : []),
      ...(all.length ? [{ type: 'label', text: strings.currencyPicker.all } as Row, ...all.map((info) => ({ type: 'currency', info }) as Row)] : []),
    ];
  }, [query, yours]);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={close} title={strings.currencyPicker.title}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={strings.currencyPicker.search}
        placeholderTextColor={colors.inkMuted}
        autoCorrect={false}
        style={[styles.search, { backgroundColor: colors.filled, color: colors.ink }]}
      />
      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.type === 'label' ? `l${i}` : `${i}-${r.info.code}`)}
        keyboardShouldPersistTaps="handled"
        style={{ maxHeight: 460 }}
        ListEmptyComponent={<Text style={[styles.empty, { color: colors.inkMuted }]}>{strings.currencyPicker.noMatch}</Text>}
        renderItem={({ item }) =>
          item.type === 'label' ? (
            <Text style={[styles.label, { color: colors.inkMuted }]}>{item.text}</Text>
          ) : (
            <SheetOption
              title={item.info.code}
              detail={item.info.name}
              selected={item.info.code === selected}
              onPress={() => {
                onSelect(item.info.code);
                close();
              }}
              leading={
                <View style={[styles.symbol, { backgroundColor: colors.filled }]}>
                  <Text style={[styles.symbolText, { color: colors.ink }]}>{item.info.symbol ?? item.info.code.slice(0, 2)}</Text>
                </View>
              }
            />
          )
        }
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  search: { borderRadius: radius.field, paddingHorizontal: 14, paddingVertical: 11, fontFamily: fonts.sans, fontSize: 14.5, marginBottom: 6 },
  label: { fontFamily: fonts.sansExtraBold, fontSize: 11, letterSpacing: 0.7, paddingTop: 14, paddingBottom: 4, paddingHorizontal: 4 },
  empty: { fontFamily: fonts.sans, fontSize: 13, padding: 16, textAlign: 'center' },
  symbol: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  symbolText: { fontFamily: fonts.monoSemiBold, fontSize: 13 },
});
