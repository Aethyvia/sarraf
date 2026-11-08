import { goBack } from '@/state/nav';
import { and, eq, isNull, min, or } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BalanceTrend } from '@/components/account/BalanceTrend';
import { FixBalanceSheet } from '@/components/account/FixBalanceSheet';
import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { DeleteInUseSheet } from '@/components/sheets/DeleteInUseSheet';
import { TransactionRow } from '@/components/transaction/TransactionRow';
import { Button, Card, Header, LinkButton, Screen, SectionLabel } from '@/components/ui';
import {
  accountDeletionImpact,
  archiveAccount,
  deleteAccount,
  setAsideByGoal,
  unarchiveAccount,
} from '@/data/accounts';
import { accountBalance, balanceSeries } from '@/data/balances';
import { listTransactions } from '@/data/transaction-list';
import { db } from '@/db/client';
import type { AppDb } from '@/db/types';
import { accounts, transactions } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { addDays, today as todayDate } from '@/lib/dates';
import { formatShortDate } from '@/lib/format-date';
import { add, dec, toDecimalString } from '@/lib/money';
import { deleteStoredFiles } from '@/services/attachments';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { usePlan } from '@/state/plan';
import { fonts, radius, useTheme } from '@/theme';

/** The account's earliest transaction date, if any. */
function firstDate(d: AppDb, id: string): string | null {
  const row = d
    .select({ first: min(transactions.date) })
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), or(eq(transactions.accountId, id), eq(transactions.toAccountId, id))))
    .get();
  return row?.first ?? null;
}

type Range = '30D' | '6M' | '1Y';
const RANGE_DAYS: Record<Range, number> = { '30D': 30, '6M': 182, '1Y': 365 };

/**
 * Account detail: balance with its trend (30D / 6M / 1Y), the currency goals
 * line, Add transaction / Fix balance / Edit, and the latest transactions.
 * Usable is per currency and lives on Home only.
 */
export default function AccountDetailScreen() {
  const s = strings.accounts;
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const plan = usePlan();
  const [deleting, setDeleting] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [range, setRange] = useState<Range>('30D');
  const data = useLive(
    (d) => {
      const account = d.select().from(accounts).where(eq(accounts.id, id)).get();
      if (!account) return null;
      const today = todayDate();
      // The trend never starts before the account's first day.
      const first = addDays(today, -(RANGE_DAYS[range] - 1));
      const opened = firstDate(d, id) ?? today;
      const from = first < opened ? (opened > today ? today : opened) : first;
      const series = balanceSeries(d, id, from, today);
      const rows = listTransactions(d, { accountIds: [id] }, today).flatMap((g) => g.rows.filter((r) => !r.echoOf));
      return {
        account,
        today,
        from,
        balance: accountBalance(d, id),
        setAside: setAsideByGoal(d, id),
        series,
        change: toDecimalString(dec(series[series.length - 1].balance).minus(dec(series[0].balance))),
        rows: rows.slice(0, 3),
      };
    },
    [id, range],
  );
  const action = useAction({ itemName: data?.account.name });
  const impact = useLive((d) => (deleting ? accountDeletionImpact(d, id) : null), [deleting, id]);

  if (!data) return null;
  const { account, balance, setAside, series, change } = data;
  const mid = series[Math.floor(series.length / 2)]?.date ?? data.from;
  const a = strings.accountDetail;
  const setAsideTotal = setAside.length ? add(...setAside.map((g) => g.amount)) : null;

  return (
    <Screen>
      <Header size={20} title={account.name} subtitle={account.currency} onBack={goBack} />
      {action.ui}

      <Card style={styles.balanceCard}>
        <Text style={[styles.balanceLabel, { color: colors.inkMuted }]}>{s.balance}</Text>
        <Money value={balance} currency={account.currency} style={styles.balance} />
        <View style={styles.trend}>
          <View style={styles.trendHead}>
            <Text style={[styles.change, { color: colors.inkSecondary }]}>
              <Money
                value={change}
                currency={account.currency}
                sign="always"
                style={[styles.changeValue, { color: dec(change).isNegative() ? colors.expense : dec(change).isZero() ? colors.inkSecondary : colors.income }]}
              />
              {a.sinceStart(formatShortDate(data.from))}
            </Text>
            <View style={[styles.ranges, { backgroundColor: colors.filled }]}>
              {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
                <Text
                  key={r}
                  onPress={() => setRange(r)}
                  accessibilityRole="button"
                  style={[styles.range, { color: r === range ? colors.ink : colors.inkMuted }, r === range && { backgroundColor: colors.surface }]}
                >
                  {a.ranges[r]}
                </Text>
              ))}
            </View>
          </View>
          <BalanceTrend points={series.map((p) => Number(p.balance))} labels={[formatShortDate(data.from), formatShortDate(mid), a.today]} />
        </View>
      </Card>

      {account.archivedAt ? (
        <Text style={[styles.notice, { color: colors.inkSecondary, backgroundColor: colors.filled }]}>{s.archivedNotice}</Text>
      ) : null}

      {setAsideTotal ? (
        <Pressable
          onPress={() => router.push('/savings')}
          accessibilityRole="button"
          style={[styles.goals, { backgroundColor: colors.surface, borderColor: colors.outline }]}
        >
          <Icon name="piggy" size={16} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.goalsText, { color: colors.ink }]}>
              <Money value={setAsideTotal} currency={account.currency} style={{ fontSize: 12.5 }} /> {s.setAside}
            </Text>
            <Text style={[styles.goalsDetail, { color: colors.inkMuted }]}>
              {s.setAsideGoals(setAside.map((g) => g.goalName).join(', '), account.currency)}
            </Text>
          </View>
          <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} />
        </Pressable>
      ) : null}

      <View style={styles.buttons}>
        {!account.archivedAt ? (
          <>
            <Button label={strings.add.title} onPress={() => router.push({ pathname: '/transaction/new', params: { accountId: id } })} style={{ flex: 1.4 }} />
            <Button kind="secondary" label={a.fixBalance} onPress={() => setFixing(true)} style={{ flex: 1 }} />
          </>
        ) : null}
        <Button kind="secondary" label={strings.common.edit} onPress={() => router.push(`/accounts/${id}/edit`)} style={account.archivedAt ? { flex: 1 } : { width: 72, paddingHorizontal: 0 }} />
      </View>

      <View style={styles.listHead}>
        <SectionLabel>{a.transactions}</SectionLabel>
        {data.rows.length ? <LinkButton label={a.seeAll} onPress={() => router.push({ pathname: '/list', params: { account: id } })} /> : null}
      </View>
      {data.rows.length ? (
        <Card>
          {data.rows.map((r, i) => (
            <TransactionRow key={r.id} row={r} variant="account" last={i === data.rows.length - 1} onPress={() => router.push(`/transaction/${r.id}`)} />
          ))}
        </Card>
      ) : (
        <Text style={[styles.notice, { color: colors.inkMuted }]}>{a.noTransactions}</Text>
      )}
      <FixBalanceSheet account={account} visible={fixing} onClose={() => setFixing(false)} />

      {account.archivedAt ? (
        <Button kind="secondary" label={strings.common.unarchive} onPress={() => action.run(() => unarchiveAccount(db, id, plan))} />
      ) : (
        <Button kind="danger" label={s.archive} onPress={() => action.run(() => archiveAccount(db, id))} />
      )}
      <LinkButton danger label={s.delete} onPress={() => setDeleting(true)} />

      {impact ? (
        <DeleteInUseSheet
          visible={deleting}
          kind="account"
          name={account.name}
          impact={impact}
          archiveNote={
            !account.archivedAt ? (
              <Text style={[styles.archiveNote, { color: colors.inkMuted }]}>
                <Money value={balance} currency={account.currency} style={{ fontSize: 12.5 }} /> · {strings.deleteInUse.moveBalanceSoon}
              </Text>
            ) : null
          }
          onArchive={
            account.archivedAt
              ? undefined
              : () => {
                  setDeleting(false);
                  action.run(() => archiveAccount(db, id));
                }
          }
          onDelete={() => {
            setDeleting(false);
            const result = action.run(() => deleteAccount(db, id));
            if (result) {
              deleteStoredFiles(result.attachmentPaths);
              router.back();
            }
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceCard: { alignItems: 'center', padding: 18, gap: 4 },
  balanceLabel: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.5 },
  balance: { fontFamily: fonts.monoSemiBold, fontSize: 30 },
  notice: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, borderRadius: radius.field, padding: 12 },
  goals: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.field, paddingHorizontal: 13, paddingVertical: 10 },
  goalsText: { fontFamily: fonts.sans, fontSize: 12.5 },
  goalsDetail: { fontFamily: fonts.sans, fontSize: 11 },
  buttons: { flexDirection: 'row', gap: 10 },
  trend: { alignSelf: 'stretch', marginTop: 10, gap: 8 },
  trendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  change: { fontFamily: fonts.sans, fontSize: 11.5 },
  changeValue: { fontFamily: fonts.monoSemiBold, fontSize: 11.5 },
  ranges: { flexDirection: 'row', borderRadius: 8, padding: 2 },
  range: { fontFamily: fonts.sansBold, fontSize: 11, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: -6 },
  archiveNote: { fontFamily: fonts.sans, fontSize: 12, marginTop: 4 },
});
