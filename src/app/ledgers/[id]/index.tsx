import { eq } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { BudgetCard } from '@/components/BudgetCard';
import { TransactionRow } from '@/components/transaction/TransactionRow';
import { Card, Header, IconButton, LinkButton, Screen, SectionLabel } from '@/components/ui';
import { budgetStatuses } from '@/data/budgets';
import { listTransactions } from '@/data/transaction-list';
import { categories, ledgers } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { today as todayDate } from '@/lib/dates';
import { goBack } from '@/state/nav';
import { useLive } from '@/state/live';
import { fonts, useTheme } from '@/theme';

/**
 * Ledger detail (board "Ledger detail"): its budgets and latest transactions.
 * A non-default ledger's budgets show only here, never on Home. ⋯ edits it.
 */
export default function LedgerDetailScreen() {
  const s = strings.ledgers;
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const data = useLive(
    (d) => {
      const ledger = d.select().from(ledgers).where(eq(ledgers.id, id)).get();
      if (!ledger) return null;
      const today = todayDate();
      const defaultLedger = d.select().from(ledgers).where(eq(ledgers.isDefault, true)).get();
      const cats = new Map(d.select().from(categories).all().map((c) => [c.id, c]));
      const statuses = budgetStatuses(d, ledger.id, today);
      // Whole-ledger caps first, then category budgets — as on Budgets.
      const budgets = [...statuses.filter((b) => !b.budget.categoryId), ...statuses.filter((b) => b.budget.categoryId)].map((status) => ({
        status,
        category: status.budget.categoryId ? (cats.get(status.budget.categoryId) ?? null) : null,
      }));
      const rows = listTransactions(d, { ledgerIds: [ledger.id] }, today)
        .flatMap((g) => g.rows.filter((r) => !r.echoOf))
        .slice(0, 5);
      return { ledger, defaultName: defaultLedger?.name ?? '', budgets, rows };
    },
    [id],
  );
  if (!data) return null;
  const { ledger, budgets, rows } = data;

  return (
    <Screen>
      <Header size={20}
        title={ledger.name}
        subtitle={ledger.isDefault ? s.isDefault : s.notDefault}
        onBack={goBack}
        actions={<IconButton icon="more" label={s.edit} onPress={() => router.push(`/ledgers/${ledger.id}/edit`)} />}
      />

      <View style={styles.section}>
        <View style={styles.head}>
          <SectionLabel>{s.budgets.toUpperCase()}</SectionLabel>
          <LinkButton label={s.addBudget} onPress={() => router.push({ pathname: '/budgets/new', params: { ledger: ledger.id } })} />
        </View>
        {budgets.length ? (
          budgets.map((b) => <BudgetCard key={b.status.budget.id} status={b.status} category={b.category} />)
        ) : (
          <Text style={[styles.empty, { color: colors.inkMuted }]}>{s.noBudgets}</Text>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.head}>
          <SectionLabel>{s.recent.toUpperCase()}</SectionLabel>
          {rows.length ? <LinkButton label={s.seeAll} onPress={() => router.push({ pathname: '/list', params: { ledger: ledger.id } })} /> : null}
        </View>
        {rows.length ? (
          <Card>
            {rows.map((r, i) => (
              <TransactionRow key={r.id} row={r} variant="ledger" last={i === rows.length - 1} onPress={() => router.push(`/transaction/${r.id}`)} />
            ))}
          </Card>
        ) : (
          <Text style={[styles.empty, { color: colors.inkMuted }]}>{s.noRecent}</Text>
        )}
      </View>

      <Text style={[styles.footer, { color: colors.inkMuted }]}>{s.footer(data.defaultName, ledger.name, ledger.isDefault)}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: { fontFamily: fonts.sans, fontSize: 12.5, paddingHorizontal: 4 },
  footer: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 17, paddingHorizontal: 4 },
});
