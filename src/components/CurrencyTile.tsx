import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import type { CurrencyTile } from '@/data/home';
import { strings } from '@/i18n/strings';
import { dec, formatAmount } from '@/lib/money';
import { fonts, radius, useTheme } from '@/theme';

/** A currency tile: balance, In / Out, Usable (red below zero), ≈ in the default currency. Opens that currency's accounts. */
export function CurrencyTileCard({ tile, estimate, defaultCurrency }: { tile: CurrencyTile; estimate: string | null; defaultCurrency: string }) {
  const s = strings.home;
  const { colors } = useTheme();
  // Long balances (lakh-grouped or with a code like "AED ") drop a size so they stay on one line.
  const long = formatAmount(tile.balance, tile.currency).text.length > 10;
  const negative = dec(tile.usable).isNegative();
  return (
    <Pressable
      style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface }, pressed && { opacity: 0.85 }]}
      onPress={() => router.push({ pathname: '/accounts', params: { currency: tile.currency } })}
      accessibilityRole="button"
    >
      <Text style={[styles.tileCode, { color: colors.inkMuted }]}>{tile.currency}</Text>
      <Money value={tile.balance} currency={tile.currency} style={[styles.tileBalance, long && styles.tileBalanceLong, { color: colors.ink }]} />
      <View style={styles.tileRows}>
        <View style={styles.tileRow}>
          <Text style={[styles.tileRowLabel, { color: colors.inkMuted }]}>{s.in}</Text>
          <Money value={tile.in} currency={tile.currency} sign="always" style={[styles.tileRowValue, { color: colors.income }]} />
        </View>
        <View style={styles.tileRow}>
          <Text style={[styles.tileRowLabel, { color: colors.inkMuted }]}>{s.out}</Text>
          <Money value={tile.out} currency={tile.currency} sign="minus" style={[styles.tileRowValue, { color: colors.expense }]} />
        </View>
      </View>
      <View style={[styles.usable, { borderTopColor: colors.filled }]}>
        <Text style={[styles.tileRowLabel, { color: colors.inkMuted }]}>
          {s.usable}{' '}
          <Money value={tile.usable} currency={tile.currency} style={[styles.usableValue, { color: negative ? colors.expense : colors.ink }]} />
        </Text>
        {tile.currency !== defaultCurrency && estimate ? (
          <Text style={[styles.tileRowLabel, { color: colors.inkMuted, marginTop: 3 }]}>
            ≈ <Money value={estimate} currency={defaultCurrency} style={[styles.tileRowLabel, { color: colors.inkMuted }]} />
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { width: '48.5%', flexGrow: 1, borderRadius: radius.card, paddingHorizontal: 16, paddingVertical: 15, elevation: 1 },
  tileCode: { fontFamily: fonts.sansExtraBold, fontSize: 11, letterSpacing: 0.66 },
  tileBalance: { fontFamily: fonts.mono, fontSize: 21, marginTop: 4 },
  tileBalanceLong: { fontSize: 17 },
  tileRows: { gap: 1, marginTop: 6 },
  tileRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  tileRowLabel: { fontFamily: fonts.sans, fontSize: 10.5 },
  tileRowValue: { fontSize: 11 },
  usable: { borderTopWidth: 1, marginTop: 6, paddingTop: 6 },
  usableValue: { fontFamily: fonts.monoSemiBold, fontSize: 10.5 },
});
