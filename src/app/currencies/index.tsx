import { goBack } from '@/state/nav';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { CurrencyTileCard as Tile } from '@/components/CurrencyTile';
import { Header, IconButton, Screen } from '@/components/ui';
import { currencyTiles, estimatedTotal } from '@/data/home';
import { strings } from '@/i18n/strings';
import { monthOf, today as todayDate } from '@/lib/dates';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { fonts, useTheme } from '@/theme';

/** All currencies (from "See all" on Home): the full grid, with a reorder button. */
export default function AllCurrenciesScreen() {
  const { colors } = useTheme();
  const { defaultCurrency } = useSettings();
  const data = useLive((db) => {
    const today = todayDate();
    return { tiles: currencyTiles(db, today), estimate: estimatedTotal(db, defaultCurrency, today), month: monthOf(today) };
  }, [defaultCurrency]);
  const monthName = strings.dates.monthsLong[Number(data.month.split('-')[1]) - 1];
  return (
    <Screen>
      <Header
        title={strings.currencies.title}
        onBack={goBack}
        actions={<IconButton icon="sort" label={strings.currencies.reorder} onPress={() => router.push('/currencies/reorder')} />}
      />
      <Text style={[styles.hint, { color: colors.inkMuted }]}>{strings.currencies.hint(monthName)}</Text>
      <View style={styles.grid}>
        {data.tiles.map((t) => (
          <Tile key={t.currency} tile={t} estimate={data.estimate.perCurrency.get(t.currency) ?? null} defaultCurrency={defaultCurrency} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.sans, fontSize: 12, paddingHorizontal: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
