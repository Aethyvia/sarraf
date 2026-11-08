import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { Card, Header, Screen, SectionLabel, SelectorRow } from '@/components/ui';
import { conversionCost } from '@/data/conversion-cost';
import { strings } from '@/i18n/strings';
import { today as todayDate } from '@/lib/dates';
import { formatShortDate } from '@/lib/format-date';
import { dec } from '@/lib/money';
import { useLive } from '@/state/live';
import { goBack } from '@/state/nav';
import { useSettings } from '@/state/settings';
import { fonts, useTheme } from '@/theme';
import { rangeFor } from './(tabs)/analytics';

type RangeKey = 'month' | 'last' | 'three' | 'year';

/** What converting cost you (Ideas added Nov 7): fees plus rate gap, per route, in the everyday currency. */
export default function ConversionCostScreen() {
  const s = strings.conversionCost;
  const { colors } = useTheme();
  const settings = useSettings();
  const [range, setRange] = useState<RangeKey>('month');
  const [picking, setPicking] = useState(false);
  const data = useLive(
    (d) => {
      const { from, to } = rangeFor(range, todayDate(), settings.fiscalYearForAnalytics ? settings.fiscalYearStartMonth : null);
      return { from, to, cost: conversionCost(d, { from, to, currency: settings.defaultCurrency }) };
    },
    [range, settings.defaultCurrency],
  );
  const c = data.cost;
  const money = (v: string, style?: object) => <Money value={v} currency={c.currency} allowCompact={false} style={[styles.mono, style]} />;
  const pct = dec(c.moved).gt(0) ? dec(c.total).dividedBy(dec(c.moved)).times(100).toDecimalPlaces(1).toFixed(1) : '0.0';
  return (
    <Screen>
      <Header size={20} title={s.title} subtitle={s.subtitle(`${formatShortDate(data.from)} – ${formatShortDate(data.to)}`, c.currency)} onBack={goBack} />
      <SelectorRow label={strings.analytics.range} value={strings.analytics.ranges[range]} onPress={() => setPicking(true)} />
      {c.routes.length === 0 ? (
        <Text style={[styles.note, { color: colors.inkSecondary }]}>{s.nothing}</Text>
      ) : (
        <>
          <Card style={styles.card}>
            <SectionLabel>{s.total}</SectionLabel>
            {money(c.total, { fontSize: 28, color: colors.ink, marginTop: 4 })}
            <Text style={[styles.small, { color: colors.inkMuted }]}>{parts(s.share(pct, money(c.moved, { fontSize: 11.5, color: colors.inkMuted })))}</Text>
            <View style={styles.split}>
              <Text style={[styles.small, { color: colors.inkSecondary }]}>
                {s.fees} {money(c.fees, { fontSize: 12, color: colors.ink })}
              </Text>
              <Text style={[styles.small, { color: colors.inkSecondary }]}>
                {s.gap} {money(c.rateGap, { fontSize: 12, color: colors.ink })}
              </Text>
            </View>
          </Card>
          <SectionLabel>{s.byRoute}</SectionLabel>
          <Card style={styles.list}>
            {c.routes.map((r, i) => (
              <View key={r.key} style={[styles.route, i < c.routes.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.routeName, { color: colors.ink }]}>{r.label}</Text>
                  <Text style={[styles.small, { color: colors.inkMuted }]}>
                    {parts(
                      s.routeDetail(
                        r.count,
                        r.key.startsWith('t:') ? 'transfer' : 'payment',
                        money(r.fees, { fontSize: 11.5, color: colors.inkMuted }),
                        r.rateGap ? money(r.rateGap, { fontSize: 11.5, color: colors.inkMuted }) : null,
                      ),
                    )}
                  </Text>
                </View>
                {money(r.total, { fontSize: 14, color: colors.ink })}
              </View>
            ))}
          </Card>
          {c.skipped ? <Text style={[styles.note, { color: colors.warning }]}>{s.skipped(c.skipped)}</Text> : null}
          <Text style={[styles.note, { color: colors.inkMuted }]}>{s.note}</Text>
        </>
      )}
      <PickerSheet
        visible={picking}
        title={strings.dateRange.title}
        sections={[{ items: (['month', 'last', 'three', 'year'] as const).map((k) => ({ id: k, title: strings.analytics.ranges[k] })) }]}
        selectedId={range}
        onSelect={(id) => setRange(id as RangeKey)}
        onClose={() => setPicking(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, gap: 2 },
  mono: { fontFamily: fonts.monoSemiBold },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 17 },
  split: { flexDirection: 'row', gap: 18, marginTop: 8 },
  list: { paddingHorizontal: 16, paddingVertical: 4 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  routeName: { fontFamily: fonts.sansSemiBold, fontSize: 13.5 },
  note: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 17, paddingHorizontal: 2 },
});
