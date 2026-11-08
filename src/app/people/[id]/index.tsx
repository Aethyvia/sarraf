import { eq } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { PersonTrend } from '@/components/people/PersonTrend';
import { SettleSheet } from '@/components/people/SettleSheet';
import { ShareSummarySheet } from '@/components/people/ShareSummarySheet';
import { rowTitle } from '@/components/transaction/TransactionRow';
import { BottomSheet, Button, Card, Header, IconButton, IconChip, Screen, SectionLabel } from '@/components/ui';
import { deleteSettlement, expectedBack, personBalances, personHistory, personSeries } from '@/data/owing';
import { db } from '@/db/client';
import { toListRowFromDb } from '@/data/transaction-list';
import { accounts, people } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { today as todayDate } from '@/lib/dates';
import { formatShortDate } from '@/lib/format-date';
import { dec, getCurrency } from '@/lib/money';
import { useLive } from '@/state/live';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Person page (Spec §13 — Decided): one balance row per currency (+ they owe
 * you, − you owe them) with a small trend, the grey Expected back line, Mark as
 * settled, and one history with running balances. One currency shows a single
 * large balance instead.
 */
export default function PersonScreen() {
  const s = strings.people;
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const [settling, setSettling] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const data = useLive(
    (db) => {
      const person = db.select().from(people).where(eq(people.id, id)).get();
      if (!person) return null;
      const today = todayDate();
      const accountNames = new Map(db.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map((a) => [a.id, a.name]));
      const history = personHistory(db, id, today).map((h) => {
        const t = h.transaction;
        let title: string = s.lines.settled;
        let detail = h.entry.note ?? '';
        if (t) {
          title = rowTitle(toListRowFromDb(db, t));
          if (h.entry.source === 'transfer') detail = t.accountId ? s.lines.lent(accountNames.get(t.accountId) ?? '') : s.lines.into(accountNames.get(t.toAccountId ?? '') ?? '');
          else if (h.entry.source === 'paid_by_person') detail = s.lines.paidBy(person.name);
          else detail = t.paidByPersonId ? s.lines.yourShare : s.lines.theirShare;
        }
        const icon = t ? toListRowFromDb(db, t).icon : { name: 'check', color: 'teal' };
        return { ...h, title, icon, detail: [formatShortDate(h.entry.date), detail, h.counts ? null : s.notCounted].filter(Boolean).join(' · ') };
      });
      const balances = [...personBalances(db, id, today)].map(([currency, balance]) => {
        const lines = history.filter((h) => h.entry.currency === currency && h.counts);
        return {
          currency,
          balance,
          series: personSeries(db, id, currency, today).map((p) => Number(p.balance)),
          count: lines.length,
          since: lines.length ? lines[lines.length - 1].entry.date : today,
        };
      });
      const back = expectedBack(db, id);
      return { person, history, balances, expected: [...back.totals], expectedCount: back.count };
    },
    [id],
  );

  if (!data) return null;
  const { person, history, balances, expected } = data;
  const single = balances.length === 1;
  const owed = balances.some((b) => !dec(b.balance).isZero());
  const tone = (v: string) => (dec(v).isNegative() ? colors.expense : dec(v).isZero() ? colors.inkMuted : colors.income);

  return (
    <Screen>
      <Header
        title={person.name}
        onBack={() => router.back()}
        actions={
          <>
            {balances.length ? <IconButton icon="share" label={s.share} onPress={() => setSharing(true)} /> : null}
            <IconButton icon="edit" label={s.edit} onPress={() => router.push(`/people/${id}/edit`)} />
          </>
        }
      />

      {balances.length === 0 ? (
        <Text style={[styles.note, { color: colors.inkSecondary, backgroundColor: colors.filled }]}>{s.nothingYet}</Text>
      ) : single ? (
        <Card style={styles.single}>
          <Text style={[styles.singleLabel, { color: colors.inkMuted }]}>{s.balance(balances[0].currency)}</Text>
          <Money value={balances[0].balance} currency={balances[0].currency} sign="always" style={[styles.singleValue, { color: tone(balances[0].balance) }]} />
          {dec(balances[0].balance).isZero() ? <Text style={[styles.small, { color: colors.inkMuted }]}>{s.settledUp}</Text> : null}
        </Card>
      ) : (
        <Card style={styles.balances}>
          {balances.map((b, i) => (
            <View key={b.currency} style={[styles.balRow, i < balances.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
              <View style={[styles.cur, { backgroundColor: colors.filled }]}>
                <Text style={[styles.curSymbol, { color: colors.ink }]}>{getCurrency(b.currency).symbol ?? b.currency.slice(0, 1)}</Text>
                <Text style={[styles.curCode, { color: colors.inkSecondary }]}>{b.currency}</Text>
              </View>
              <View style={styles.balMiddle}>
                <PersonTrend points={b.series} color={tone(b.balance)} />
                <Text style={[styles.small, { color: colors.inkMuted }]} numberOfLines={1}>
                  {dec(b.balance).isZero() ? s.settledUp : s.entries(b.count, formatShortDate(b.since))}
                </Text>
              </View>
              <Money value={b.balance} currency={b.currency} sign="always" style={[styles.balValue, { color: tone(b.balance) }]} />
            </View>
          ))}
        </Card>
      )}

      {expected.length ? (
        <Pressable
          onPress={() => router.push({ pathname: '/transactions', params: { reimbursable: '1' } })}
          style={[styles.expected, { backgroundColor: colors.filled }]}
          accessibilityRole="button"
        >
          <Icon name="undo" size={15} color={colors.inkSecondary} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            {expected.map(([currency, amount]) => (
              <Text key={currency} style={[styles.expectedTitle, { color: colors.inkSecondary }]}>
                {parts(s.expectedBack(<Money value={amount} currency={currency} style={[styles.expectedTitle, { fontFamily: fonts.mono }]} />, data.expectedCount))}
              </Text>
            ))}
            <Text style={[styles.small, { color: colors.inkMuted }]}>{s.expectedBackDetail}</Text>
          </View>
          <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} />
        </Pressable>
      ) : null}

      {owed ? <Button kind="secondary" label={s.markSettled} onPress={() => setSettling(true)} /> : null}

      {history.length ? (
        <View>
          <SectionLabel style={{ paddingHorizontal: 2, paddingBottom: 8 }}>{s.history}</SectionLabel>
          {history.map((h, i) => (
            <Pressable
              key={h.entry.id}
              onPress={() => (h.transaction ? router.push(`/transaction/${h.transaction.id}`) : setRemoving(h.entry.id))}
              style={({ pressed }) => [
                styles.line,
                i < history.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line },
                !h.counts && { opacity: 0.55 },
                pressed && { backgroundColor: colors.filled },
              ]}
            >
              <IconChip icon={h.icon.name} color={h.icon.color} size={32} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.lineTitle, { color: colors.ink }]} numberOfLines={1}>
                  {h.title}
                </Text>
                <Text style={[styles.small, { color: colors.inkMuted }]} numberOfLines={1}>
                  {h.detail}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Money value={h.entry.amount} currency={h.entry.currency} sign="always" style={[styles.lineAmount, { color: tone(h.entry.amount) }]} />
                <Text style={[styles.tiny, { color: colors.inkMuted }]}>
                  {s.runningBal(single ? null : h.entry.currency)}
                  <Money value={h.running} currency={h.entry.currency} sign={dec(h.running).isZero() ? 'auto' : 'always'} style={[styles.tiny, { fontFamily: fonts.mono }]} />
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      <BottomSheet visible={removing !== null} onClose={() => setRemoving(null)} title={s.removeSettlement}>
        <View style={{ gap: 12 }}>
          <Text style={[styles.small, { color: colors.inkSecondary, fontSize: 13, lineHeight: 19 }]}>{s.removeSettlementDetail(person.name)}</Text>
          <Button
            label={s.removeSettlement}
            style={{ backgroundColor: colors.expense }}
            onPress={() => {
              if (removing) deleteSettlement(db, removing);
              setRemoving(null);
            }}
          />
          <Button kind="secondary" label={strings.common.cancel} onPress={() => setRemoving(null)} />
        </View>
      </BottomSheet>

      <SettleSheet visible={settling} person={person} balances={balances} onClose={() => setSettling(false)} />
      <ShareSummarySheet visible={sharing} person={person} balances={balances} history={history} onClose={() => setSharing(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, borderRadius: radius.field, padding: 12 },
  single: { alignItems: 'center', padding: 18, gap: 4 },
  singleLabel: { fontFamily: fonts.sansBold, fontSize: 11.5, letterSpacing: 0.55 },
  singleValue: { fontFamily: fonts.mono, fontSize: 34 },
  balances: { paddingHorizontal: 16, paddingVertical: 4 },
  balRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  cur: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  curSymbol: { fontFamily: fonts.monoSemiBold, fontSize: 15, lineHeight: 17 },
  curCode: { fontFamily: fonts.sansExtraBold, fontSize: 9 },
  balMiddle: { flex: 1, minWidth: 0, gap: 3, paddingHorizontal: 4 },
  balValue: { fontFamily: fonts.mono, fontSize: 18 },
  small: { fontFamily: fonts.sans, fontSize: 11.5 },
  tiny: { fontFamily: fonts.sans, fontSize: 10.5 },
  expected: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.field, paddingHorizontal: 13, paddingVertical: 10, marginTop: -6 },
  expectedTitle: { fontFamily: fonts.sansSemiBold, fontSize: 12.5 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 4 },
  lineTitle: { fontFamily: fonts.sansSemiBold, fontSize: 13.5 },
  lineAmount: { fontFamily: fonts.monoSemiBold, fontSize: 13.5 },
});
