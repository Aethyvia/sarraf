import { goBack } from '@/state/nav';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GotItSheet } from '@/components/transaction/GotItSheet';
import { RecurringRow } from '@/components/RecurringRow';
import { Money } from '@/components/Money';
import { BottomSheet, Button, Card, Header, Screen, SectionLabel, SheetOption } from '@/components/ui';
import { cancelTransaction, confirmLabel, confirmTransaction, markInTransit, needsDetailsToConfirm, needsReview } from '@/data/review';
import { skipRecurring } from '@/data/recurring';
import type { TransactionRow } from '@/data/transactions';
import { db } from '@/db/client';
import { accounts, categories, people } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { today as todayDate } from '@/lib/dates';
import { formatShortDate } from '@/lib/format-date';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { clearAddedWhileAway, useAddedWhileAway } from '@/state/away';
import { outstandingOf } from '@/data/owing';
import { toDecimalString } from '@/lib/money';
import { fonts, radius, useTheme } from '@/theme';

interface Names {
  account: (id: string | null) => string;
  category: (id: string | null) => string | null;
  person: (id: string | null) => string;
}

function useNames(): Names {
  const maps = useLive((d) => ({
    accounts: new Map(d.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map((a) => [a.id, a.name])),
    categories: new Map(d.select({ id: categories.id, name: categories.name }).from(categories).all().map((c) => [c.id, c.name])),
    people: new Map(d.select({ id: people.id, name: people.name }).from(people).all().map((p) => [p.id, p.name])),
  }));
  return {
    account: (id) => (id ? (maps.accounts.get(id) ?? '') : ''),
    category: (id) => (id ? (maps.categories.get(id) ?? null) : null),
    person: (id) => (id ? (maps.people.get(id) ?? '') : ''),
  };
}

/** A row's title, as in lists: the note's first line, else the category; a transfer is "From → To". */
function titleOf(t: TransactionRow, n: Names): string {
  if (t.kind === 'transfer') {
    const from = t.accountId ? n.account(t.accountId) : n.person(t.transferPersonId);
    const to = t.toAccountId ? n.account(t.toAccountId) : n.person(t.transferPersonId);
    return `${from} → ${to}`;
  }
  return t.notes?.split('\n')[0] || (n.category(t.categoryId) ?? strings.add.noCategory);
}

/** Needs review (Spec §10): Recurring, Pending, In transit, Waiting for money back, Upcoming. */
export default function ReviewScreen() {
  const s = strings.review;
  const { colors } = useTheme();
  const today = todayDate();
  const data = useLive((d) => needsReview(d, todayDate()));
  const expected = useLive(
    (d) => new Map(data.waitingBack.map((t) => { const o = outstandingOf(d, t); return [t.id, { value: toDecimalString(o.outstanding), currency: o.currency }]; })),
    [data.waitingBack.map((t) => t.id).join()],
  );
  const names = useNames();
  const action = useAction();
  const [options, setOptions] = useState<TransactionRow | null>(null);
  const [confirming, setConfirming] = useState<TransactionRow | null>(null);
  const [gotIt, setGotIt] = useState<string | null>(null);
  // Added while Sarraf was closed (owner, Nov 14: shown here instead of a pop-up on open).
  const awayIds = useAddedWhileAway();
  const away = data.recurring.filter((t) => awayIds.includes(t.id));

  const startConfirm = (t: TransactionRow) => {
    if (needsDetailsToConfirm(t)) {
      router.push({ pathname: '/transaction/[id]/edit', params: { id: t.id, confirm: '1' } });
      return;
    }
    setConfirming(t);
  };

  // Tapping a row shows its details; waiting-back rows open the expense itself (Owner, Nov 11: no ⋯ button).
  const openRow = (t: TransactionRow, button: 'confirm' | 'date' | 'gotIt') => (button === 'gotIt' ? router.push(`/transaction/${t.id}`) : setOptions(t));
  const row = (t: TransactionRow, detail: string, button: 'confirm' | 'date' | 'gotIt', last: boolean) => (
    <Pressable
      key={t.id}
      onPress={() => openRow(t, button)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, !last && { borderBottomWidth: 1, borderBottomColor: colors.line }, pressed && { backgroundColor: colors.filled }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.title, { color: colors.ink }]} numberOfLines={1}>
          {titleOf(t, names)}
        </Text>
        <Text style={[styles.detail, { color: colors.inkMuted }]} numberOfLines={2}>
          {button === 'gotIt' ? (
            // Waiting for money back: what's still expected, charges included (owner, Nov 15).
            <Money value={expected.get(t.id)?.value ?? t.amount} currency={expected.get(t.id)?.currency ?? t.currency} style={styles.detailMoney} />
          ) : (
            <Money value={t.kind === 'transfer' && t.toAmount ? t.toAmount : t.amount} currency={t.kind === 'transfer' && t.toAmount && t.toAccountId ? currencyOf(t.toAccountId) : t.currency} style={styles.detailMoney} />
          )}
          {detail ? ` · ${detail}` : ''}
        </Text>
      </View>
      {button === 'date' ? (
        <Text style={[styles.date, { color: colors.inkSecondary }]}>{formatShortDate(t.date)}</Text>
      ) : button === 'gotIt' ? (
        <Button kind="secondary" label={s.gotIt} onPress={() => setGotIt(t.id)} style={styles.action} />
      ) : (
        <Button label={confirmLabel(t) === 'paid' ? s.paid : s.received} onPress={() => startConfirm(t)} style={styles.action} />
      )}
    </Pressable>
  );

  const accountCurrencies = useLive((d) => new Map(d.select({ id: accounts.id, c: accounts.currency }).from(accounts).all().map((a) => [a.id, a.c])));
  function currencyOf(id: string) {
    return accountCurrencies.get(id) ?? 'USD';
  }

  const section = (label: string, items: TransactionRow[], detail: (t: TransactionRow) => string, button: (t: TransactionRow) => 'confirm' | 'date' | 'gotIt') =>
    items.length ? (
      <View style={{ gap: 8 }} key={label}>
        <SectionLabel>{label}</SectionLabel>
        <Card>{items.map((t, i) => row(t, detail(t), button(t), i === items.length - 1))}</Card>
      </View>
    ) : null;

  const where = (t: TransactionRow) => (t.accountId ? names.account(t.accountId) : t.paidByPersonId ? `Paid by ${names.person(t.paidByPersonId)}` : names.account(t.toAccountId));
  const empty = !data.recurring.length && !data.reminders.length && !data.pending.length && !data.inTransit.length && !data.waitingBack.length && !data.upcoming.length;

  return (
    <Screen>
      <Header size={20} title={s.title} subtitle={empty ? undefined : s.summary(data.toConfirm, data.upcomingCount, data.waitingBack.length)} onBack={goBack} />
      {action.ui}
      {empty ? <Text style={[styles.empty, { color: colors.inkSecondary }]}>{s.empty}</Text> : null}
      {away.length ? (
        <Card style={[styles.away, { borderColor: colors.warningSoft }]}>
          <Text style={[styles.awayTitle, { color: colors.ink }]}>{strings.recurring.awayTitle(away.length)}</Text>
          <Text style={[styles.detail, { color: colors.inkSecondary }]}>{strings.recurring.awayBody(away.length)}</Text>
          <View style={styles.awayButtons}>
            <Button kind="secondary" label={strings.recurring.awayGotIt} onPress={clearAddedWhileAway} style={{ flex: 1 }} />
            <Button
              kind="danger"
              label={strings.recurring.cancelAll(away.length)}
              onPress={() =>
                action.run(() => {
                  for (const t of away) cancelTransaction(db, t.id);
                  clearAddedWhileAway();
                })
              }
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : null}
      {section(s.recurring, data.recurring, (t) => [s.addedAuto(formatShortDate(t.date)), where(t)].join(' · '), () => 'confirm')}
      {data.reminders.length ? (
        <View style={{ gap: 8 }}>
          {!data.recurring.length ? <SectionLabel>{s.recurring}</SectionLabel> : null}
          <Card>
            {data.reminders.map((r, i) => (
              <RecurringRow
                key={r.id}
                item={r}
                variant="review"
                last={i === data.reminders.length - 1}
                onSkip={() => action.run(() => skipRecurring(db, r.id))}
                buttonStyle={styles.action}
              />
            ))}
          </Card>
        </View>
      ) : null}
      {section(s.pending, data.pending, (t) => [t.expectedDate ? s.expectedOn(formatShortDate(t.expectedDate)) : formatShortDate(t.date), where(t)].join(' · '), () => 'confirm')}
      {section(s.inTransit, data.inTransit, (t) => s.sentOn(formatShortDate(t.date)), () => 'confirm')}
      {section(
        s.waitingBack,
        data.waitingBack,
        (t) => [t.expectedFromPersonId ? s.fromPerson(names.person(t.expectedFromPersonId)) : null, s.since(formatShortDate(t.date))].filter(Boolean).join(' · '),
        () => 'gotIt',
      )}
      {section(s.upcoming, data.upcoming, (t) => where(t), (t) => (t.date > today ? 'date' : 'confirm'))}
      {!empty ? <Text style={[styles.footer, { color: colors.inkMuted }]}>{s.footer}</Text> : null}

      <ItemOptionsSheet
        item={options}
        names={names}
        onClose={() => setOptions(null)}
        onEdit={(t) => {
          setOptions(null);
          router.push({ pathname: '/transaction/[id]/edit', params: { id: t.id, confirm: '1' } });
        }}
        onInTransit={(t) => {
          setOptions(null);
          action.run(() => markInTransit(db, t.id));
        }}
        onCancel={(t) => {
          setOptions(null);
          action.run(() => cancelTransaction(db, t.id));
        }}
      />
      <ConfirmDateSheet
        item={confirming}
        title={confirming ? titleOf(confirming, names) : ''}
        where={confirming ? where(confirming) : ''}
        onClose={() => setConfirming(null)}
        onConfirm={(t, date) => {
          setConfirming(null);
          action.run(() => confirmTransaction(db, t.id, date));
        }}
      />
      <GotItSheet expenseId={gotIt} onClose={() => setGotIt(null)} />
    </Screen>
  );
}

function ItemOptionsSheet({
  item,
  names,
  onClose,
  onEdit,
  onInTransit,
  onCancel,
}: {
  item: TransactionRow | null;
  names: Names;
  onClose: () => void;
  onEdit: (t: TransactionRow) => void;
  onInTransit: (t: TransactionRow) => void;
  onCancel: (t: TransactionRow) => void;
}) {
  const { colors } = useTheme();
  const s = strings.review;
  if (!item) return null;
  const facts: [string, React.ReactNode][] = [
    [s.amount, <Money key="a" value={item.amount} currency={item.currency} allowCompact={false} style={styles.factMoney} />],
    [item.kind === 'income' ? strings.add.account : item.kind === 'transfer' ? strings.add.from : strings.add.paidFrom, item.accountId ? names.account(item.accountId) : names.person(item.paidByPersonId ?? item.transferPersonId)],
    ...(item.kind !== 'transfer' ? ([[strings.add.category, names.category(item.categoryId) ?? strings.add.noCategory]] as [string, string][]) : []),
    [item.autoAdded ? s.addedOn : s.date, formatShortDate(item.date)],
  ];
  return (
    <BottomSheet visible onClose={onClose} title={titleOf(item, names)}>
      <View style={[styles.facts, { backgroundColor: colors.filled }]}>
        {facts.map(([label, value]) => (
          <View key={label} style={styles.fact}>
            <Text style={[styles.factLabel, { color: colors.inkMuted }]}>{label}</Text>
            {typeof value === 'string' ? <Text style={[styles.factValue, { color: colors.ink }]}>{value}</Text> : value}
          </View>
        ))}
      </View>
      <SheetOption title={s.editAndAdd} detail={s.editAndAddDetail} onPress={() => onEdit(item)} />
      {item.status === 'pending' && item.kind === 'transfer' ? (
        <SheetOption title={strings.add.statuses.in_transit} detail={strings.add.statusDetail.in_transit} onPress={() => onInTransit(item)} />
      ) : null}
      <SheetOption danger title={s.cancelled} detail={item.autoAdded ? s.cancelledRecurringDetail : s.cancelledDetail} onPress={() => onCancel(item)} />
    </BottomSheet>
  );
}

/** "Today or the original date?" (Decided Nov 7), defaulting to today. */
function ConfirmDateSheet({
  item,
  title,
  where,
  onClose,
  onConfirm,
}: {
  item: TransactionRow | null;
  title: string;
  where: string;
  onClose: () => void;
  onConfirm: (t: TransactionRow, date: string) => void;
}) {
  const { colors } = useTheme();
  const c = strings.confirmDate;
  const today = todayDate();
  const [choice, setChoice] = useState<{ for: string | null; date: string }>({ for: null, date: today });
  if (!item) return null;
  const date = choice.for === item.id ? choice.date : today;
  const pick = (d: string) => setChoice({ for: item.id, date: d });
  const month = (d: string) => strings.dates.monthsLong[Number(d.split('-')[1]) - 1];
  const paid = confirmLabel(item) === 'paid';
  const original = item.date <= today ? item.date : today;

  return (
    <BottomSheet visible onClose={onClose} title={paid ? c.titlePaid : c.titleReceived}>
      <Text style={[styles.recorded, { color: colors.inkSecondary }]}>
        {c.recorded(`${title} · ${where}`, formatShortDate(item.date), strings.add.statuses[item.status as 'pending' | 'in_transit' | 'cleared'] ?? '')}
      </Text>
      <SheetOption title={c.today} detail={c.countsIn(formatShortDate(today), month(today))} selected={date === today} onPress={() => pick(today)} />
      {original !== today ? (
        <SheetOption title={c.original} detail={c.alsoIn(formatShortDate(original), month(original))} selected={date === original} onPress={() => pick(original)} />
      ) : null}
      <SheetOption
        title={date !== today && date !== original ? formatShortDate(date) : c.pick}
        selected={date !== today && date !== original}
        onPress={() => {
          const [y, m, d] = date.split('-').map(Number);
          DateTimePickerAndroid.open({
            value: new Date(y, m - 1, d),
            mode: 'date',
            maximumDate: new Date(),
            onChange: (e, picked) => e.type === 'set' && picked && pick(todayDate(picked)),
          });
        }}
      />
      <Text style={[styles.hint, { color: colors.inkMuted }]}>{c.hint}</Text>
      <Button label={paid ? c.markPaid : c.markReceived} onPress={() => onConfirm(item, date)} style={{ marginTop: 10 }} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  away: { gap: 8, padding: 16, borderWidth: 1 },
  awayTitle: { fontFamily: fonts.sansBold, fontSize: 14 },
  awayButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  /** Every action on this page is the same size: Paid, Received, Add, Got it, and the date. */
  action: { width: 96, paddingHorizontal: 0 },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 14.5 },
  detail: { fontFamily: fonts.sans, fontSize: 12 },
  detailMoney: { fontSize: 12 },
  date: { fontFamily: fonts.sansSemiBold, fontSize: 13, width: 96, textAlign: 'center' },
  empty: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19, paddingVertical: 24, textAlign: 'center' },
  footer: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 4 },
  facts: { borderRadius: radius.field, padding: 12, gap: 8, marginBottom: 8 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  factLabel: { fontFamily: fonts.sans, fontSize: 13 },
  factValue: { fontFamily: fonts.sansSemiBold, fontSize: 13, flexShrink: 1, textAlign: 'right' },
  factMoney: { fontSize: 13 },
  recorded: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, paddingHorizontal: 4, paddingBottom: 6 },
  hint: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 4, paddingTop: 8 },
});
