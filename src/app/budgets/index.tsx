import { eq } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { BudgetCard } from '@/components/BudgetCard';
import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { Button, Card, Header, IconButton, Screen, SectionLabel } from '@/components/ui';
import { budgetStatuses, overlapWarnings } from '@/data/budgets';
import { categories, ledgers } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { today as todayDate } from '@/lib/dates';
import { useLive } from '@/state/live';
import { goBack } from '@/state/nav';
import { fonts, radius, useTheme } from '@/theme';

/** Budgets (one ledger): whole-ledger caps per currency, then category budgets per currency. */
export default function BudgetsScreen() {
  const s = strings.budgets;
  const { colors } = useTheme();
  const { ledger: ledgerParam } = useLocalSearchParams<{ ledger?: string }>();
  const data = useLive(
    (d) => {
      const ledger = ledgerParam
        ? d.select().from(ledgers).where(eq(ledgers.id, ledgerParam)).get()
        : d.select().from(ledgers).where(eq(ledgers.isDefault, true)).get();
      if (!ledger) return null;
      const today = todayDate();
      return {
        ledger,
        today,
        statuses: budgetStatuses(d, ledger.id, today),
        overlap: overlapWarnings(d, ledger.id),
        cats: new Map(d.select().from(categories).all().map((c) => [c.id, c])),
      };
    },
    [ledgerParam],
  );
  if (!data) return null;
  const { ledger, statuses, overlap, cats } = data;
  const month = strings.dates.monthsLong[Number(data.today.slice(5, 7)) - 1];
  const currencies = [...new Set(statuses.map((b) => b.budget.currency))];
  const money = (v: string, c: string) => <Money value={v} currency={c} allowCompact={false} style={[styles.inlineMoney, { color: colors.warning }]} />;

  return (
    <Screen>
      <Header
        title={s.title}
        subtitle={s.subtitle(month, ledger.name)}
        onBack={goBack}
        actions={<IconButton icon="plus" filled label={s.add} onPress={() => router.push({ pathname: '/budgets/new', params: { ledger: ledger.id } })} />}
      />
      {overlap.map((o) => (
        <View key={o.currency} style={[styles.warn, { backgroundColor: colors.warningTint, borderColor: colors.warningLine }]}>
          <Icon name="alert" size={16} color={colors.warning} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.warnTitle, { color: colors.warning }]}>{s.overlapTitle}</Text>
            <Text style={[styles.warnBody, { color: colors.warning }]}>{parts(s.overlapBody(money(o.categories, o.currency), money(o.over, o.currency), money(o.cap, o.currency), o.currency))}</Text>
          </View>
        </View>
      ))}
      {statuses.length === 0 ? (
        <>
          <Card style={styles.empty}>
            <Icon name="chart" size={30} color={colors.border} strokeWidth={1.6} />
            <Text style={[styles.emptyTitle, { color: colors.inkSecondary }]}>{s.emptyTitle}</Text>
            <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>{s.emptyBody}</Text>
          </Card>
          <Button label={s.add} onPress={() => router.push({ pathname: '/budgets/new', params: { ledger: ledger.id } })} />
        </>
      ) : null}
      {currencies.map((c) => {
        const whole = statuses.filter((b) => b.budget.currency === c && !b.budget.categoryId);
        const byCat = statuses.filter((b) => b.budget.currency === c && b.budget.categoryId);
        return (
          <View key={c} style={{ gap: 14 }}>
            {whole.map((b) => (
              <BudgetCard key={b.budget.id} status={b} />
            ))}
            {byCat.length ? <SectionLabel>{s.byCategory(c)}</SectionLabel> : null}
            {byCat.map((b) => (
              <BudgetCard key={b.budget.id} status={b} category={cats.get(b.budget.categoryId!) ?? null} />
            ))}
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  warn: { flexDirection: 'row', gap: 10, borderRadius: radius.card, borderWidth: 1.5, padding: 14 },
  warnTitle: { fontFamily: fonts.sansBold, fontSize: 13 },
  warnBody: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, marginTop: 2 },
  inlineMoney: { fontFamily: fonts.monoSemiBold, fontSize: 12 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 30, paddingHorizontal: 20 },
  emptyTitle: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  emptyBody: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 19, textAlign: 'center', maxWidth: 260 },
});
