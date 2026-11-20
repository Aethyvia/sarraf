import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TabHeaderActions } from '@/components/TabHeaderActions';
import { Icon } from '@/components/icons/Icon';
import { CurrencyTileCard as Tile } from '@/components/CurrencyTile';
import { DefaultCurrencyCard } from '@/components/DefaultCurrencyCard';
import { Money } from '@/components/Money';
import { AutoTag, RecurringRow } from '@/components/RecurringRow';
import { BudgetCard } from '@/components/BudgetCard';
import { TransactionRow } from '@/components/transaction/TransactionRow';
import { Card, IconChip, LinkButton, SectionLabel } from '@/components/ui';
import { currencyBalanceTrend, currencyTiles, estimatedTotal, RATES_WARN_AFTER_DAYS, splitDefaultTile } from '@/data/home';
import { budgetStatuses } from '@/data/budgets';
import { recurringOnHome } from '@/data/recurring';
import { categories, ledgers, settings, transactions } from '@/db/schema';
import { db } from '@/db/client';
import type { AppDb } from '@/db/types';
import { count, eq, isNull } from 'drizzle-orm';
import { needsReview } from '@/data/review';
import { recentTransactions } from '@/data/transaction-list';
import { strings } from '@/i18n/strings';
import { nowIso, today as todayDate } from '@/lib/dates';
import { formatShortDate } from '@/lib/format-date';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { Tour, TourTarget } from '@/components/tour/Tour';
import { useAddedWhileAway } from '@/state/away';
import { showGuestReminder } from '@/data/guest';
import { currentUser } from '@/data/backup-flow';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Home's budgets (Spec §8): only the default ledger's — any that are over,
 * then the whole-ledger caps.
 */
function homeBudgets(db: AppDb, today: string) {
  const ledger = db.select().from(ledgers).where(eq(ledgers.isDefault, true)).get();
  if (!ledger) return null;
  const cats = new Map(db.select().from(categories).all().map((c) => [c.id, c]));
  const all = budgetStatuses(db, ledger.id, today);
  const shown = [...all.filter((b) => b.over && b.budget.categoryId), ...all.filter((b) => !b.budget.categoryId)].map((status) => ({
    status,
    category: status.budget.categoryId ? (cats.get(status.budget.categoryId) ?? null) : null,
  }));
  return { ledger: ledger.name, shown };
}

/** Tiles shown on Home before "See all N currencies". */
const HOME_TILES = 4;

/**
 * Home (Spec §8 — Decided): the estimated total, a tile per currency
 * (balance, this month's In / Out, Usable, ≈), what needs confirming, and the
 * last 6 transactions. Budgets and Recurring join with their build layers.
 */
export default function HomeScreen() {
  const s = strings.home;
  const { colors, swatch } = useTheme();
  const { defaultCurrency } = useSettings();
  const data = useLive((d) => {
    const today = todayDate();
    return {
      today,
      tiles: currencyTiles(d, today),
      trend: currencyBalanceTrend(d, defaultCurrency, today).map((x) => x.balance),
      estimate: estimatedTotal(d, defaultCurrency, today),
      review: needsReview(d, today),
      recent: recentTransactions(d, 6, today),
      recurring: recurringOnHome(d, today),
      budgets: homeBudgets(d, today),
      categoryLooks: new Map(d.select({ id: categories.id, icon: categories.icon, color: categories.color }).from(categories).all().map((c) => [c.id, c])),
      guestReminder: (() => {
        const set = d.select({ on: settings.onboardingCompletedAt, at: settings.guestReminderAt }).from(settings).get();
        return showGuestReminder({
          signedIn: !!currentUser(d),
          onboardedAt: set?.on ?? null,
          transactionCount: d.select({ n: count() }).from(transactions).where(isNull(transactions.deletedAt)).get()?.n ?? 0,
          dismissedAt: set?.at ?? null,
          now: nowIso(),
        });
      })(),
    };
  }, [defaultCurrency]);

  const { tiles, trend, estimate, review, recent, recurring, budgets, categoryLooks, guestReminder } = data;
  // The default currency comes first, full width; the others follow in two columns (owner, Nov 20).
  const { big, rest } = splitDefaultTile(tiles, defaultCurrency);
  // Added while Sarraf was closed and still waiting on Needs review (owner, Nov 14: no pop-up).
  const awayIds = useAddedWhileAway();
  const away = review.recurring.filter((t) => awayIds.includes(t.id));
  const look = (id: string | null | undefined) => (id ? (categoryLooks.get(id) ?? null) : null);
  const fixed = recurring.filter((r) => r.item.amountType === 'same');
  const bills = recurring.filter((r) => r.item.amountType === 'varies');
  // Added automatically and waiting in Needs review: shown here too, with an Auto tag (Spec §8).
  const autoAdded = review.recurring;
  const ratesAge = estimate.ratesFrom ? Math.floor((Date.parse(`${data.today}T12:00:00`) - Date.parse(estimate.ratesFrom)) / 86400000) : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <Tour id="home" steps={strings.tour.home} enabled={tiles.length > 0} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.ink }]}>{s.title}</Text>
          <TabHeaderActions />
        </View>

        {tiles.length > 0 ? (
          estimate.total !== null ? (
            <TourTarget id="home.estimate">
            <Card style={styles.estimate}>
              <Text style={[styles.estimateLabel, { color: colors.inkMuted }]}>{s.estimated(estimate.currency)}</Text>
              <Text style={[styles.estimateValue, { color: colors.ink }]}>
                ≈ <Money value={estimate.total} currency={estimate.currency} style={[styles.estimateValue, { color: colors.ink }]} />
              </Text>
              {estimate.ratesFrom && ratesAge >= 1 ? (
                <Text style={[styles.ratesFrom, { color: colors.inkMuted }]}>{s.ratesFrom(formatShortDate(estimate.ratesFrom.slice(0, 10)))}</Text>
              ) : null}
              {ratesAge > RATES_WARN_AFTER_DAYS ? <Text style={[styles.ratesWarn, { color: colors.warning }]}>{s.ratesOld(ratesAge)}</Text> : null}
            </Card>
            </TourTarget>
          ) : (
            <Text style={[styles.hidden, { color: colors.inkSecondary, backgroundColor: colors.filled }]}>{s.totalHidden}</Text>
          )
        ) : (
          <Text style={[styles.hidden, { color: colors.inkSecondary, backgroundColor: colors.filled }]}>{s.noAccounts}</Text>
        )}

        <TourTarget id="home.tiles" style={styles.grid}>
          {big ? <DefaultCurrencyCard tile={big} trend={trend} /> : null}
          {rest.slice(0, HOME_TILES).map((t) => (
            <Tile key={t.currency} tile={t} estimate={estimate.perCurrency.get(t.currency) ?? null} defaultCurrency={defaultCurrency} />
          ))}
        </TourTarget>
        {rest.length > HOME_TILES ? (
          <View style={{ marginTop: -12, marginBottom: -8 }}>
            <LinkButton label={s.seeAll(tiles.length)} onPress={() => router.push('/currencies')} />
          </View>
        ) : null}

        {guestReminder ? (
          <Card style={[styles.confirm, { borderColor: colors.warningSoft }]}>
            <View style={[styles.confirmBadge, { backgroundColor: colors.warningSoft }]}>
              <Icon name="cloud" size={16} color={swatch('gold').fg} strokeWidth={1.9} />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.confirmTitle, { color: colors.ink, fontFamily: fonts.sansBold, fontSize: 13.5 }]}>{s.guestTitle}</Text>
              <Text style={[styles.confirmDetail, { color: colors.inkMuted, fontSize: 11.5 }]}>{s.guestBody}</Text>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <LinkButton label={s.guestSignIn} onPress={() => router.push('/start')} />
                <LinkButton label={s.guestNotNow} onPress={() => db.update(settings).set({ guestReminderAt: nowIso() }).run()} />
              </View>
            </View>
          </Card>
        ) : null}

        {review.toConfirm > 0 || review.waitingBack.length > 0 ? (
          <Pressable onPress={() => router.push('/review')} accessibilityRole="button">
            <Card style={[styles.confirm, { borderColor: colors.warningSoft }]}>
              <View style={[styles.confirmBadge, { backgroundColor: colors.warningSoft }]}>
                <Icon name="review" size={16} color={swatch('gold').fg} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.confirmTitle, { color: colors.ink, fontFamily: fonts.sansBold, fontSize: 13.5 }]}>
                  {review.toConfirm > 0 ? s.needConfirm(review.toConfirm) : s.waitingOnly(review.waitingBack.length)}
                </Text>
                <Text style={[styles.confirmDetail, { color: away.length ? colors.ink : colors.inkMuted, fontSize: 11.5 }]}>
                  {away.length ? s.awayDetail(away.length) : s.needConfirmDetail}
                </Text>
              </View>
              <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} />
            </Card>
          </Pressable>
        ) : null}

        {budgets && budgets.shown.length ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <SectionLabel>{strings.budgets.homeTitle(budgets.ledger)}</SectionLabel>
              <LinkButton label={strings.recurring.seeAll} onPress={() => router.push('/budgets')} />
            </View>
            {budgets.shown.map((b) => (
              <BudgetCard key={b.status.budget.id} status={b.status} category={b.category} compact />
            ))}
          </View>
        ) : null}

        {recurring.length || autoAdded.length ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <SectionLabel>{strings.recurring.title.toUpperCase()}</SectionLabel>
              <LinkButton label={strings.recurring.seeAll} onPress={() => router.push('/recurring')} />
            </View>
            {fixed.length || autoAdded.length ? <Text style={[styles.groupLabel, { color: colors.inkMuted }]}>{strings.recurring.homeFixed}</Text> : null}
            {fixed.map((r) => (
              <RecurringRow key={r.item.id} item={r.item} variant="home" category={look(r.item.categoryId)} />
            ))}
            {autoAdded.map((t) => (
              <Pressable key={t.id} onPress={() => router.push('/review')}>
                <Card style={styles.autoRow}>
                  <IconChip icon="repeat" color={look(t.categoryId)?.color ?? 'neutral'} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.confirmTitle, { color: colors.ink }]} numberOfLines={1}>
                      {t.notes?.split('\n')[0] ?? strings.recurring.title}
                    </Text>
                    <Text style={[styles.confirmDetail, { color: colors.inkMuted }]} numberOfLines={1}>
                      <Money value={t.amount} currency={t.currency} style={styles.confirmDetail} /> · {strings.recurring.addedAuto(formatShortDate(t.date))}
                    </Text>
                  </View>
                  <AutoTag />
                </Card>
              </Pressable>
            ))}
            {bills.length ? <Text style={[styles.groupLabel, { color: colors.inkMuted, paddingTop: 4 }]}>{strings.recurring.homeBills}</Text> : null}
            {bills.map((r) => (
              <RecurringRow key={r.item.id} item={r.item} variant="home" category={look(r.item.categoryId)} />
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
        <View style={styles.sectionHead}>
          <SectionLabel>{s.recent.toUpperCase()}</SectionLabel>
          {recent.length ? <LinkButton label={s.seeAllShort} onPress={() => router.push('/transactions')} /> : null}
        </View>
        {recent.length ? (
          recent.map((r) => (
            <View key={r.id}>
              <TransactionRow row={r} variant="recent" onPress={() => router.push(`/transaction/${r.id}`)} />
              {/* Money back shows under its expense (owner, Nov 14). */}
              {r.children.map((c, i) => (
                <TransactionRow key={c.id} row={c} child onPress={() => router.push(`/transaction/${r.id}`)} last={i < r.children.length - 1} />
              ))}
            </View>
          ))
        ) : (
          <Card style={styles.empty}>
            <Icon name="nav-transactions" size={26} color={colors.border} strokeWidth={1.6} />
            <Text style={[styles.emptyTitle, { color: colors.inkSecondary }]}>{s.emptyRecentTitle}</Text>
            <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>{s.emptyRecentBody}</Text>
          </Card>
        )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20, gap: 22 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: -4 },
  title: { fontFamily: fonts.serif, fontSize: 20 },
  estimate: { padding: 16, alignItems: 'center', gap: 4 },
  estimateLabel: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.53, textAlign: 'center' },
  estimateValue: { fontFamily: fonts.monoSemiBold, fontSize: 32 },
  ratesFrom: { fontFamily: fonts.sans, fontSize: 11.5, textAlign: 'center' },
  ratesWarn: { fontFamily: fonts.sansSemiBold, fontSize: 11.5, lineHeight: 16, marginTop: 4, textAlign: 'center' },
  hidden: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, borderRadius: radius.field, padding: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 15, borderWidth: 1 },
  confirmBadge: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  confirmCount: { fontFamily: fonts.monoSemiBold, fontSize: 14 },
  confirmTitle: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  confirmDetail: { fontFamily: fonts.sans, fontSize: 12 },
  section: { gap: 10 },
  groupLabel: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.53, paddingHorizontal: 2 },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 22, paddingHorizontal: 16 },
  emptyTitle: { fontFamily: fonts.sansSemiBold, fontSize: 13.5 },
  emptyBody: { fontFamily: fonts.sans, fontSize: 12, textAlign: 'center', maxWidth: 220 },
});
