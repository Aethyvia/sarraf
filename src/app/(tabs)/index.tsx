import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { CurrencyTileCard as Tile } from '@/components/CurrencyTile';
import { Money } from '@/components/Money';
import { RecurringRow } from '@/components/RecurringRow';
import { TransactionRow } from '@/components/transaction/TransactionRow';
import { Card, IconButton, LinkButton, SectionLabel } from '@/components/ui';
import { currencyTiles, estimatedTotal, RATES_WARN_AFTER_DAYS } from '@/data/home';
import { recurringOnHome } from '@/data/recurring';
import { needsReview } from '@/data/review';
import { recentTransactions } from '@/data/transaction-list';
import { strings } from '@/i18n/strings';
import { today as todayDate } from '@/lib/dates';
import { formatShortDate } from '@/lib/format-date';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { fonts, radius, useTheme } from '@/theme';

/** Tiles shown on Home before "See all N currencies". */
const HOME_TILES = 4;

/**
 * Home (Spec §8 — Decided): the estimated total, a tile per currency
 * (balance, this month's In / Out, Usable, ≈), what needs confirming, and the
 * last 6 transactions. Budgets and Recurring join with their build layers.
 */
export default function HomeScreen() {
  const s = strings.home;
  const { colors } = useTheme();
  const { defaultCurrency } = useSettings();
  const data = useLive((db) => {
    const today = todayDate();
    return {
      today,
      tiles: currencyTiles(db, today),
      estimate: estimatedTotal(db, defaultCurrency, today),
      review: needsReview(db, today),
      recent: recentTransactions(db, 6, today),
      recurring: recurringOnHome(db, today),
    };
  }, [defaultCurrency]);

  const { tiles, estimate, review, recent, recurring } = data;
  const fixed = recurring.filter((r) => r.item.amountType === 'same');
  const bills = recurring.filter((r) => r.item.amountType === 'varies');
  // Added automatically and waiting in Needs review: shown here too, with an Auto tag (Spec §8).
  const autoAdded = review.recurring;
  const ratesAge = estimate.ratesFrom ? Math.floor((Date.parse(`${data.today}T12:00:00`) - Date.parse(estimate.ratesFrom)) / 86400000) : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.ink }]}>{s.title}</Text>
          <IconButton icon="settings" label={strings.settings.title} onPress={() => router.push('/settings')} />
        </View>

        {tiles.length > 0 ? (
          estimate.total !== null ? (
            <View style={styles.estimate}>
              <Text style={[styles.estimateLabel, { color: colors.inkMuted }]}>{s.estimated(estimate.currency)}</Text>
              <Text style={[styles.estimateValue, { color: colors.ink }]}>
                ≈ <Money value={estimate.total} currency={estimate.currency} style={[styles.estimateValue, { color: colors.ink }]} />
              </Text>
              {estimate.ratesFrom && ratesAge >= 1 ? (
                <Text style={[styles.ratesFrom, { color: colors.inkMuted }]}>{s.ratesFrom(formatShortDate(estimate.ratesFrom.slice(0, 10)))}</Text>
              ) : null}
              {ratesAge > RATES_WARN_AFTER_DAYS ? <Text style={[styles.ratesWarn, { color: colors.warning }]}>{s.ratesOld(ratesAge)}</Text> : null}
            </View>
          ) : (
            <Text style={[styles.hidden, { color: colors.inkSecondary, backgroundColor: colors.filled }]}>{s.totalHidden}</Text>
          )
        ) : (
          <Text style={[styles.hidden, { color: colors.inkSecondary, backgroundColor: colors.filled }]}>{s.noAccounts}</Text>
        )}

        <View style={styles.grid}>
          {tiles.slice(0, HOME_TILES).map((t) => (
            <Tile key={t.currency} tile={t} estimate={estimate.perCurrency.get(t.currency) ?? null} defaultCurrency={defaultCurrency} />
          ))}
        </View>
        {tiles.length > HOME_TILES ? <LinkButton label={s.seeAll(tiles.length)} onPress={() => router.push('/currencies')} /> : null}

        {review.toConfirm > 0 || review.waitingBack.length > 0 ? (
          <Pressable onPress={() => router.push('/review')} accessibilityRole="button">
            <Card style={styles.confirm}>
              <View style={[styles.confirmBadge, { backgroundColor: colors.warningSoft }]}>
                <Text style={[styles.confirmCount, { color: colors.warning }]}>{review.toConfirm || review.waitingBack.length}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.confirmTitle, { color: colors.ink }]}>
                  {review.toConfirm > 0 ? s.needConfirm(review.toConfirm) : s.waitingOnly(review.waitingBack.length)}
                </Text>
                <Text style={[styles.confirmDetail, { color: colors.inkMuted }]}>{s.needConfirmDetail}</Text>
              </View>
              <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} />
            </Card>
          </Pressable>
        ) : null}

        {recurring.length || autoAdded.length ? (
          <>
            <View style={styles.sectionHead}>
              <SectionLabel>{strings.recurring.title.toUpperCase()}</SectionLabel>
              <LinkButton label={strings.recurring.seeAll} onPress={() => router.push('/recurring')} />
            </View>
            <Card>
              {fixed.length || autoAdded.length ? <Text style={[styles.groupLabel, { color: colors.inkMuted }]}>{strings.recurring.homeFixed}</Text> : null}
              {fixed.map((r, i) => (
                <RecurringRow key={r.item.id} item={r.item} variant="home" last={i === fixed.length - 1 && !autoAdded.length && !bills.length} />
              ))}
              {autoAdded.map((t, i) => (
                <Pressable key={t.id} onPress={() => router.push('/review')} style={[styles.autoRow, (i < autoAdded.length - 1 || bills.length > 0) && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.confirmTitle, { color: colors.ink }]} numberOfLines={1}>
                      {t.notes?.split('\n')[0] ?? strings.recurring.title}
                    </Text>
                    <Text style={[styles.confirmDetail, { color: colors.inkMuted }]} numberOfLines={1}>
                      <Money value={t.amount} currency={t.currency} style={[styles.confirmDetail, { fontFamily: fonts.mono }]} /> · {strings.recurring.addedAuto(formatShortDate(t.date))}
                    </Text>
                  </View>
                  <Text style={[styles.autoTag, { color: colors.inkSecondary, backgroundColor: colors.filled }]}>{strings.recurring.auto}</Text>
                </Pressable>
              ))}
              {bills.length ? <Text style={[styles.groupLabel, { color: colors.inkMuted }]}>{strings.recurring.homeBills}</Text> : null}
              {bills.map((r, i) => (
                <RecurringRow key={r.item.id} item={r.item} variant="home" last={i === bills.length - 1} />
              ))}
            </Card>
          </>
        ) : null}

        <View style={styles.sectionHead}>
          <SectionLabel>{s.recent.toUpperCase()}</SectionLabel>
          {recent.length ? <LinkButton label={s.seeAllShort} onPress={() => router.push('/transactions')} /> : null}
        </View>
        {recent.length ? (
          <Card>
            {recent.map((r, i) => (
              <TransactionRow key={r.id} row={r} variant="recent" last={i === recent.length - 1} onPress={() => router.push(`/transaction/${r.id}`)} />
            ))}
          </Card>
        ) : (
          <Card style={styles.empty}>
            <Icon name="nav-transactions" size={26} color={colors.border} strokeWidth={1.6} />
            <Text style={[styles.emptyTitle, { color: colors.inkSecondary }]}>{s.emptyRecentTitle}</Text>
            <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>{s.emptyRecentBody}</Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.serif, fontSize: 22 },
  estimate: { gap: 2, paddingHorizontal: 2 },
  estimateLabel: { fontFamily: fonts.sansExtraBold, fontSize: 10.5, letterSpacing: 0.6 },
  estimateValue: { fontFamily: fonts.mono, fontSize: 26 },
  ratesFrom: { fontFamily: fonts.sans, fontSize: 11.5 },
  ratesWarn: { fontFamily: fonts.sansSemiBold, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  hidden: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, borderRadius: radius.field, padding: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  confirmBadge: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  confirmCount: { fontFamily: fonts.monoSemiBold, fontSize: 14 },
  confirmTitle: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  confirmDetail: { fontFamily: fonts.sans, fontSize: 12 },
  groupLabel: { fontFamily: fonts.sansExtraBold, fontSize: 10.5, letterSpacing: 0.6, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  autoTag: { fontFamily: fonts.sansBold, fontSize: 10.5, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: -6 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 22, paddingHorizontal: 16 },
  emptyTitle: { fontFamily: fonts.sansSemiBold, fontSize: 13.5 },
  emptyBody: { fontFamily: fonts.sans, fontSize: 12, textAlign: 'center', maxWidth: 220 },
});
