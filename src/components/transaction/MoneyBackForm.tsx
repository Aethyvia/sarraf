import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { eq } from 'drizzle-orm';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AmountTextInput } from '@/components/AmountTextInput';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { useAccountSections } from '@/components/sheets/pickers';
import { Button, Field, SelectorRow } from '@/components/ui';
import { addMoneyBack, refundableLeft, type MoneyBackKind } from '@/data/money-back';
import { chargedCurrencyOf, outstandingOf } from '@/data/owing';
import { marketRate } from '@/data/rates';
import { db } from '@/db/client';
import { accounts, categories, transactions } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { today as todayDate } from '@/lib/dates';
import { convert, dec, parseTypedAmount, toDecimalString, toTypedText } from '@/lib/money';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';
import { formatLongDate, trimRate } from './parts';

/**
 * Money back on an expense: Got it (a reimbursement) or a refund. Pick the
 * account it arrived in, what arrived, and — in another currency — what it
 * counts as in the expense's currency, pre-filled at today's market rate.
 */
export function MoneyBackForm({ parentId, kind, onDone }: { parentId: string; kind: MoneyBackKind; onDone: () => void }) {
  const s = strings.moneyBack;
  const { colors } = useTheme();
  const { numberFormat } = useSettings();
  const toast = useToast();
  const action = useAction();
  const today = todayDate();

  const base = useLive(
    (d) => {
      const parent = d.select().from(transactions).where(eq(transactions.id, parentId)).get();
      if (!parent) return null;
      const currency = chargedCurrencyOf(d, parent);
      const left = kind === 'refund' ? refundableLeft(d, parentId).amount : toDecimalString(outstandingOf(d, parent).outstanding);
      const category = parent.categoryId ? d.select({ name: categories.name }).from(categories).where(eq(categories.id, parent.categoryId)).get()?.name : null;
      return { parent, currency, left, category: category ?? s.uncategorized };
    },
    [parentId, kind],
  );
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState<string | null>(null);
  const [countsText, setCountsText] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [picking, setPicking] = useState(false);
  const accountSections = useAccountSections();

  const chosenId = accountId ?? base?.parent.accountId ?? null;
  const account = useLive((d) => (chosenId ? (d.select().from(accounts).where(eq(accounts.id, chosenId)).get() ?? null) : null), [chosenId]);
  const rate = useLive((d) => (account && base && account.currency !== base.currency ? marketRate(d, account.currency, base.currency) : null), [account?.currency, base?.currency]);
  if (!base) return null;

  const other = !!account && account.currency !== base.currency;
  const left = dec(base.left).gt(0) ? base.left : '0';
  // Defaults: what's still expected, in the receiving account's currency.
  const defaultAmount = !account ? '' : !other ? left : rate ? convert(left, toDecimalString(dec('1').dividedBy(dec(rate.rate))), account.currency) : '';
  const amount = amountText !== null ? parseTypedAmount(amountText, numberFormat) : defaultAmount || null;
  // Untouched, the pre-filled amount counts as exactly what's still expected (no round trip through the rate).
  const defaultCounts = !other ? null : amountText === null && defaultAmount ? left : amount && rate ? convert(amount, rate.rate, base.currency) : null;
  const countsAs = !other ? amount : countsText !== null ? parseTypedAmount(countsText, numberFormat) : defaultCounts;
  const after = countsAs ? toDecimalString(dec(left).minus(dec(countsAs))) : left;
  const afterStatus = dec(after).lte(0) ? 'reimbursed' : 'partly_back';
  const overRefund = kind === 'refund' && !!countsAs && dec(countsAs).gt(dec(left));
  const valid = !!account && !!amount && dec(amount).gt(0) && !!countsAs && dec(countsAs).gt(0) && !overRefund;

  const pickDate = () => {
    const [y, m, d] = date.split('-').map(Number);
    DateTimePickerAndroid.open({
      value: new Date(y, m - 1, d),
      mode: 'date',
      maximumDate: new Date(),
      onChange: (e, picked) => e.type === 'set' && picked && setDate(todayDate(picked)),
    });
  };
  const save = () => {
    if (!valid) return;
    const done = action.run(() =>
      addMoneyBack(db, { parentId, kind, accountId: account!.id, amount: amount!, date, countsAs: other ? countsAs : null, notes: notes || null }),
    );
    if (done) {
      toast({ message: kind === 'refund' ? s.refundDone : s.gotItDone });
      onDone();
    }
  };
  const money = (v: string, c: string, extra?: object) => <Money value={v} currency={c} allowCompact={false} style={[styles.mono, extra]} />;

  return (
    <View style={{ gap: 14 }}>
      {action.ui}
      <SelectorRow label={kind === 'refund' ? s.refundedTo : s.receivedInto} value={account?.name ?? '—'} onPress={() => setPicking(true)} />

      <View>
        <Text style={[styles.label, { color: colors.inkMuted }]}>{kind === 'refund' ? s.refundAmount : s.amountReceived}</Text>
        <View style={[styles.amountBox, { borderColor: colors.accent, backgroundColor: colors.surface }]}>
          <Text style={[styles.code, { color: colors.inkSecondary }]}>{account?.currency ?? ''}</Text>
          <AmountTextInput
            value={amountText ?? (defaultAmount ? toTypedText(defaultAmount, numberFormat) : '')}
            onChangeText={setAmountText}
            keyboardType="numeric"
            placeholder="0.00"
            placeholderTextColor={colors.inkMuted}
            style={[styles.amountInput, { color: colors.ink }]}
          />
        </View>
        {kind === 'refund' && !other ? <Text style={[styles.hint, { color: overRefund ? colors.expense : colors.inkMuted }]}>{parts(s.refundHint(money(left, base.currency, { fontSize: 11.5 })))}</Text> : null}
      </View>

      {other ? (
        <View>
          <Text style={[styles.label, { color: colors.inkMuted }]}>{s.countsAs}</Text>
          <View style={[styles.amountBox, { borderColor: colors.border, backgroundColor: colors.filled }]}>
            <Text style={[styles.code, { color: colors.inkSecondary }]}>{base.currency}</Text>
            <AmountTextInput
              value={countsText ?? (defaultCounts ? toTypedText(defaultCounts, numberFormat) : '')}
              onChangeText={setCountsText}
              keyboardType="numeric"
              placeholder="0.00"
              placeholderTextColor={colors.inkMuted}
              style={[styles.amountInput, { color: colors.ink }]}
            />
          </View>
          {rate ? (
            <Text style={[styles.hint, { color: colors.inkMuted }]}>
              {s.atRate(`1 ${base.currency} = ${trimRate(toDecimalString(dec('1').dividedBy(dec(rate.rate))))} ${account!.currency}`)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {kind === 'reimbursement' ? (
        <View style={styles.afterRow}>
          <Text style={[styles.hint, { color: colors.inkMuted, marginTop: 0 }]}>{s.stillExpected}</Text>
          <Text style={[styles.hint, { color: colors.ink, marginTop: 0 }]}>
            {money(dec(after).lt(0) ? '0' : after, base.currency, { fontSize: 12 })} · {s.statuses[afterStatus]}
          </Text>
        </View>
      ) : null}

      <SelectorRow label={s.date} value={date === today ? s.today(formatLongDate(date)) : formatLongDate(date)} onPress={pickDate} />
      {kind === 'refund' ? <Field label={s.notes} optional value={notes} onChangeText={setNotes} placeholder={s.refundNotesPlaceholder} /> : null}

      <Text style={[styles.small, { color: colors.inkMuted }]}>
        {kind === 'refund'
          ? s.refundExplain
          : account && amount && countsAs
            ? parts(s.gotItExplain(money(amount, account.currency, { fontSize: 11.5 }), account.name, base.category, money(countsAs, base.currency, { fontSize: 11.5 })))
            : null}
      </Text>
      <Button label={kind === 'refund' ? s.saveRefund : s.save} disabled={!valid} onPress={save} />

      <PickerSheet
        visible={picking}
        title={kind === 'refund' ? s.pickRefundedTo : s.pickReceivedInto}
        sections={accountSections}
        selectedId={chosenId}
        onSelect={(id) => {
          setAccountId(id);
          setAmountText(null);
          setCountsText(null);
        }}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 5 },
  amountBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: radius.field, paddingHorizontal: 14 },
  code: { fontFamily: fonts.sansBold, fontSize: 11 },
  amountInput: { flex: 1, fontFamily: fonts.mono, fontSize: 17, paddingVertical: 10 },
  hint: { fontFamily: fonts.sans, fontSize: 11.5, marginTop: 6, paddingHorizontal: 2 },
  afterRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 17 },
  mono: { fontFamily: fonts.monoSemiBold, fontSize: 12 },
});
