import { isNull } from 'drizzle-orm';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Donut } from '@/components/charts/Donut';
import { TrendLines } from '@/components/charts/TrendLines';
import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { Card, IconButton, SectionLabel } from '@/components/ui';
import { flows, monthlyTrend, UNCATEGORIZED } from '@/data/spending';
import { accounts, categories, ledgers, people } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { addDays, monthOf, monthRange, today as todayDate } from '@/lib/dates';
import { dec } from '@/lib/money';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { fonts, radius, useTheme } from '@/theme';

type RangeKey = 'month' | 'last' | 'three' | 'year';

/** The date range for a preset. "This year" follows the fiscal year when that's turned on for Analytics. */
export function rangeFor(key: RangeKey, today: string, fiscalStart: number | null): { from: string; to: string } {
  const month = monthOf(today);
  const [y, m] = today.split('-').map(Number);
  switch (key) {
    case 'month':
      return { from: monthRange(month).from, to: today };
    case 'last': {
      const prev = monthOf(addDays(monthRange(month).from, -1));
      return monthRange(prev);
    }
    case 'three': {
      const total = y * 12 + (m - 1) - 2;
      return { from: `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`, to: today };
    }
    case 'year': {
      if (!fiscalStart || fiscalStart === 1) return { from: `${y}-01-01`, to: today };
      const startYear = m >= fiscalStart ? y : y - 1;
      return { from: `${startYear}-${String(fiscalStart).padStart(2, '0')}-01`, to: today };
    }
  }
}

/**
 * Analytics (Decided Nov 7): ledger, range and currency at the top; the monthly
 * trend; expense by category as a donut (tap to highlight, then View in
 * Transactions); income by category; income by person when it's on.
 */
export default function AnalyticsScreen() {
  const s = strings.analytics;
  const { colors, swatch } = useTheme();
  const settings = useSettings();
  const [ledgerId, setLedgerId] = useState<string | null | undefined>(undefined);
  const [range, setRange] = useState<RangeKey>('month');
  const [currency, setCurrency] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'ledger' | 'range' | 'currency' | null>(null);

  const data = useLive(
    (d) => {
      const today = todayDate();
      const ledgerRows = d.select().from(ledgers).where(isNull(ledgers.archivedAt)).orderBy(ledgers.rank).all();
      const currencies = [...new Set(d.select({ c: accounts.currency }).from(accounts).where(isNull(accounts.archivedAt)).all().map((a) => a.c))];
      const ledger = ledgerId === undefined ? (ledgerRows.find((l) => l.isDefault)?.id ?? null) : ledgerId;
      const cur = currency ?? (currencies.includes(settings.defaultCurrency) ? settings.defaultCurrency : (currencies[0] ?? settings.defaultCurrency));
      const { from, to } = rangeFor(range, today, settings.fiscalYearForAnalytics ? settings.fiscalYearStartMonth : null);
      return {
        today,
        ledgerRows,
        currencies,
        ledger,
        currency: cur,
        from,
        to,
        flows: flows(d, { currency: cur, from, to, ledgerId: ledger }),
        trend: monthlyTrend(d, { currency: cur, ledgerId: ledger }, today, 6),
        cats: new Map(d.select().from(categories).all().map((c) => [c.id, c])),
        names: new Map(d.select({ id: people.id, name: people.name }).from(people).all().map((p) => [p.id, p.name])),
      };
    },
    [ledgerId, range, currency, settings.defaultCurrency, settings.fiscalYearForAnalytics, settings.fiscalYearStartMonth],
  );

  const f = data.flows;
  const catName = (id: string) => (id === UNCATEGORIZED ? s.uncategorized : (data.cats.get(id)?.name ?? s.uncategorized));
  const catColor = (id: string) => swatch(data.cats.get(id)?.color ?? 'neutral').fg;
  const sel = f.spending.find((x) => x.categoryId === selected) ?? null;
  const money = (v: string, style?: object) => <Money value={v} currency={f.currency} allowCompact={false} style={style} />;
  const ledgerName = data.ledger ? (data.ledgerRows.find((l) => l.id === data.ledger)?.name ?? '') : s.allLedgers;
  const maxIncome = Math.max(0, ...f.income.map((x) => Number(x.amount)));
  const maxPerson = Math.max(0, ...f.incomeByPerson.map((x) => Number(x.amount)));

  const view = (categoryId: string) =>
    router.push({
      pathname: '/list',
      params: { ledger: data.ledger ?? '', from: data.from, to: data.to, currency: f.currency, kind: 'expense', category: categoryId, fromAnalytics: '1' },
    });

  const chip = (key: 'ledger' | 'range' | 'currency', label: string | null, value: string) => (
    <Pressable onPress={() => setSheet(key)} style={[styles.chip, { backgroundColor: colors.filled }]} accessibilityRole="button">
      {label ? <Text style={[styles.chipLabel, { color: colors.inkMuted }]}>{label}</Text> : null}
      <Text style={[styles.chipValue, { color: colors.ink }]}>{value}</Text>
      <Icon name="down" size={11} color={colors.inkSecondary} strokeWidth={2.4} />
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.ink }]}>{s.title}</Text>
            <Text style={[styles.sub, { color: colors.inkMuted }]}>{s.subtitle}</Text>
          </View>
          <IconButton icon="settings" label={strings.settings.title} onPress={() => router.push('/settings')} />
        </View>
        <View style={styles.chips}>
          {chip('ledger', s.ledger, ledgerName)}
          {chip('range', s.range, s.ranges[range])}
          {chip('currency', null, f.currency)}
        </View>

        <Card style={styles.card}>
          <SectionLabel style={{ marginBottom: 12 }}>{s.trend}</SectionLabel>
          <TrendLines
            months={data.trend.map((t) => t.month)}
            income={data.trend.map((t) => Number(t.income))}
            spending={data.trend.map((t) => Number(t.spending))}
            labels={data.trend.map((t) => strings.dates.months[Number(t.month.slice(5, 7)) - 1])}
          />
          <View style={styles.legend}>
            <View style={[styles.swatch, { backgroundColor: colors.income }]} />
            <Text style={[styles.legendText, { color: colors.inkSecondary }]}>{s.income}</Text>
            <View style={[styles.swatch, { backgroundColor: colors.expense, marginStart: 12 }]} />
            <Text style={[styles.legendText, { color: colors.inkSecondary }]}>{s.expense}</Text>
          </View>
        </Card>

        <Card style={[styles.card, { alignItems: 'center' }]}>
          <SectionLabel style={{ alignSelf: 'flex-start', marginBottom: 14 }}>{s.byCategory}</SectionLabel>
          {f.spending.length === 0 ? (
            <Text style={[styles.sub, { color: colors.inkMuted, alignSelf: 'flex-start' }]}>{s.nothing}</Text>
          ) : (
            <>
              {sel ? (
                <View style={styles.tappedRow}>
                  <Text style={[styles.tapped, { color: colors.inkMuted }]}>{s.tapped(catName(sel.categoryId))}</Text>
                  <IconButton icon="close" label={strings.common.close} onPress={() => setSelected(null)} />
                </View>
              ) : null}
              <Donut
                slices={f.spending.filter((x) => dec(x.amount).gt(0)).map((x) => ({ key: x.categoryId, value: Number(x.amount), color: catColor(x.categoryId) }))}
                selected={selected}
                gapColor={colors.surface}
                onSelect={(key) => setSelected((cur) => (cur === key ? null : key))}
              >
                {sel ? (
                  <>
                    <Text style={[styles.centreLabel, { color: colors.inkMuted }]}>
                      {parts(s.shareOf(Math.round((Number(sel.amount) / Number(f.totalSpending)) * 100), money(f.totalSpending, [styles.centreLabel, { color: colors.inkMuted }])))}
                    </Text>
                    {money(sel.amount, [styles.centreValue, { color: colors.ink }])}
                  </>
                ) : (
                  <>
                    <Text style={[styles.centreLabel, { color: colors.inkMuted }]}>{s.total}</Text>
                    {money(f.totalSpending, [styles.centreValue, { color: colors.ink }])}
                  </>
                )}
              </Donut>
              <View style={styles.legendList}>
                {f.spending.map((x) => {
                  const on = selected === x.categoryId;
                  return (
                    <Pressable
                      key={x.categoryId}
                      onPress={() => setSelected((cur) => (cur === x.categoryId ? null : x.categoryId))}
                      style={[styles.legendRow, on && { backgroundColor: colors.filled }, selected && !on && { opacity: 0.4 }]}
                    >
                      <View style={styles.legendTop}>
                        <View style={[styles.dot, { backgroundColor: catColor(x.categoryId) }]} />
                        <Text style={[styles.legendName, { color: colors.inkSecondary }]} numberOfLines={1}>
                          {catName(x.categoryId)}
                        </Text>
                        {money(x.amount, [styles.legendAmount, { color: dec(x.amount).isNegative() ? colors.income : colors.ink }])}
                      </View>
                      {on ? (
                        <View style={styles.viewRow}>
                          <Text style={[styles.count, { color: colors.inkMuted }]}>{s.count(x.count)}</Text>
                          <Text onPress={() => view(x.categoryId)} style={[styles.viewLink, { color: colors.accent }]} accessibilityRole="link">
                            {s.view}
                          </Text>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
        </Card>

        {f.income.length ? (
          <Card style={styles.card}>
            <SectionLabel style={{ marginBottom: 12 }}>{s.incomeByCategory}</SectionLabel>
            <View style={{ gap: 10 }}>
              {f.income.map((x) => {
                const subs = f.incomeSubs.filter((sub) => sub.parentId === x.categoryId && sub.categoryId !== x.categoryId);
                return (
                  <View key={x.categoryId} style={{ gap: 8 }}>
                    <Bar label={catName(x.categoryId)} value={x.amount} max={maxIncome} currency={f.currency} />
                    {subs.map((sub) => (
                      <View key={sub.categoryId} style={{ paddingStart: 16 }}>
                        <Bar label={catName(sub.categoryId)} value={sub.amount} max={Number(x.amount)} currency={f.currency} small />
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}

        {settings.showIncomeByPerson && f.incomeByPerson.length ? (
          <Card style={styles.card}>
            <SectionLabel>{s.incomeByPerson}</SectionLabel>
            <Text style={[styles.note, { color: colors.inkMuted }]}>{s.byPersonNote}</Text>
            <View style={{ gap: 10 }}>
              {f.incomeByPerson.map((x) => (
                <Bar key={x.personId ?? 'none'} label={x.personId ? (data.names.get(x.personId) ?? '') : s.noPerson} value={x.amount} max={maxPerson} currency={f.currency} />
              ))}
            </View>
          </Card>
        ) : null}

        <Pressable onPress={() => router.push('/conversion-cost')} accessibilityRole="button">
          <Card style={[styles.card, styles.linkCard]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.ink }]}>{s.conversion}</Text>
              <Text style={[styles.note, { color: colors.inkMuted, marginBottom: 0 }]}>{s.conversionDetail}</Text>
            </View>
            <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} />
          </Card>
        </Pressable>
      </ScrollView>

      <PickerSheet
        visible={sheet === 'ledger'}
        title={strings.ledgers.title}
        sections={[{ items: [{ id: '', title: s.allLedgers }, ...data.ledgerRows.map((l) => ({ id: l.id, title: l.name }))] }]}
        selectedId={data.ledger ?? ''}
        onSelect={(id) => {
          setLedgerId(id || null);
          setSelected(null);
        }}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'range'}
        title={strings.dateRange.title}
        sections={[{ items: (['month', 'last', 'three', 'year'] as const).map((k) => ({ id: k, title: s.ranges[k] })) }]}
        selectedId={range}
        onSelect={(id) => {
          setRange(id as RangeKey);
          setSelected(null);
        }}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'currency'}
        title={strings.accounts.currency}
        sections={[{ items: data.currencies.map((c) => ({ id: c, title: c })) }]}
        selectedId={f.currency}
        onSelect={(id) => {
          setCurrency(id);
          setSelected(null);
        }}
        onClose={() => setSheet(null)}
      />
    </SafeAreaView>
  );
}

function Bar({ label, value, max, currency, small }: { label: string; value: string; max: number; currency: string; small?: boolean }) {
  const { colors } = useTheme();
  const pct = max > 0 ? Math.max(2, Math.min(100, (Number(value) / max) * 100)) : 0;
  return (
    <View>
      <Text style={[small ? styles.barLabelSmall : styles.barLabel, { color: small ? colors.inkSecondary : colors.ink }]}>{label}</Text>
      <View style={styles.barRow}>
        <View style={[styles.barTrack, small && styles.barTrackSmall, { backgroundColor: colors.accentSoft }]}>
          <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: small ? colors.accent + 'AA' : colors.income }]} />
        </View>
        <Money value={value} currency={currency} allowCompact={false} style={[small ? styles.barValueSmall : styles.barValue, { color: small ? colors.inkSecondary : colors.ink }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontFamily: fonts.serif, fontSize: 24 },
  sub: { fontFamily: fonts.sans, fontSize: 13, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  chipLabel: { fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.3 },
  chipValue: { fontFamily: fonts.sansBold, fontSize: 13 },
  card: { padding: 18 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  swatch: { width: 9, height: 9, borderRadius: 3 },
  legendText: { fontFamily: fonts.sans, fontSize: 11.5 },
  tappedRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 8, marginBottom: 8 },
  tapped: { flex: 1, fontFamily: fonts.sans, fontSize: 11.5 },
  centreLabel: { fontFamily: fonts.sans, fontSize: 11, textAlign: 'center' },
  centreValue: { fontFamily: fonts.mono, fontSize: 19 },
  legendList: { alignSelf: 'stretch', gap: 2, marginTop: 16 },
  legendRow: { borderRadius: radius.field, paddingHorizontal: 8, paddingVertical: 6 },
  legendTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 9, height: 9, borderRadius: radius.pill },
  legendName: { flex: 1, fontFamily: fonts.sans, fontSize: 12.5 },
  legendAmount: { fontFamily: fonts.mono, fontSize: 12.5 },
  viewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingStart: 16, marginTop: 4 },
  count: { fontFamily: fonts.sans, fontSize: 11.5 },
  viewLink: { fontFamily: fonts.sansBold, fontSize: 12 },
  note: { fontFamily: fonts.sans, fontSize: 11, marginBottom: 10 },
  barLabel: { fontFamily: fonts.sansSemiBold, fontSize: 12.5, marginBottom: 4 },
  barLabelSmall: { fontFamily: fonts.sans, fontSize: 11.5, marginBottom: 4 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: { flex: 1, height: 18, borderRadius: 5, overflow: 'hidden' },
  barTrackSmall: { height: 14, borderRadius: 4 },
  barFill: { height: '100%', borderRadius: 5 },
  barValue: { fontFamily: fonts.monoSemiBold, fontSize: 12.5 },
  barValueSmall: { fontFamily: fonts.mono, fontSize: 11.5 },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkTitle: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
});
