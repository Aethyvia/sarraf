import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { eq } from 'drizzle-orm';
import { useState, type ReactNode } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';

import { AmountBox, ConversionTrio, type TrioSlot } from '@/components/AmountBox';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { useAccountSections } from '@/components/sheets/pickers';
import { Field, SelectorRow } from '@/components/ui';
import { vsMarketPercent } from '@/data/amounts';
import { addMoneyBack, refundableLeft, type MoneyBackKind } from '@/data/money-back';
import { chargedCurrencyOf, outstandingOf } from '@/data/owing';
import { marketRate } from '@/data/rates';
import { db } from '@/db/client';
import { accounts, categories, transactions } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { expressionValue, pressKey, type CalcKey } from '@/lib/calc';
import { today as todayDate } from '@/lib/dates';
import { convert, dec, getCurrency, toDecimalString } from '@/lib/money';
import { RATE_MAX_DECIMALS } from '@/state/transaction-form';
import { rateFromYFirst, workOut } from '@/state/conversion';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { useToast } from '@/state/toast';
import { fonts, useTheme } from '@/theme';
import { formatLongDate, trimRate } from './parts';

export interface MoneyBackParts {
  ready: boolean;
  /** The rows above the amount (account, date, notes, what it does). */
  rows: ReactNode;
  /** The amount — or, in another currency, amount back · rate · counts as — docked above the keypad. */
  amount: ReactNode;
  onKey: (key: CalcKey) => void;
  save: () => void;
  valid: boolean;
  /** Sheets this form opens (render once, anywhere). */
  sheets: ReactNode;
  actionUi: ReactNode;
}

/**
 * Money back on an expense: Got it (a reimbursement) or a refund. Pick the
 * account it arrived in and what arrived; in another currency, the amount
 * back, the rate and what it counts as in the expense's currency (option D,
 * Owner Nov 12): tap the one you know. All on Sarraf's keypad.
 */
export function useMoneyBack(parentId: string, kind: MoneyBackKind, onDone: () => void): MoneyBackParts {
  const s = strings.moneyBack;
  const { colors } = useTheme();
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
  // null = untouched: pre-filled with what's still expected / today's market rate.
  const [amountText, setAmountText] = useState<string | null>(null);
  const [rateText, setRateText] = useState<string | null>(null);
  // null = untouched: counts as what's still expected (council fix, Nov 12: what's shown is what's saved).
  const [countsText, setCountsText] = useState<string | null>(null);
  const [known, setKnown] = useState<'rate' | 'y'>('y');
  const [focus, setFocus] = useState<TrioSlot>('amount');
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [picking, setPicking] = useState(false);
  const accountSections = useAccountSections();
  // A different expense (the Got it sheet is reused): start fresh.
  const [forId, setForId] = useState(parentId);
  if (forId !== parentId) {
    setForId(parentId);
    setAccountId(null);
    setAmountText(null);
    setRateText(null);
    setCountsText(null);
    setKnown('y');
    setFocus('amount');
    setDate(today);
    setNotes('');
  }

  const chosenId = accountId ?? base?.parent.accountId ?? null;
  const account = useLive((d) => (chosenId ? (d.select().from(accounts).where(eq(accounts.id, chosenId)).get() ?? null) : null), [chosenId]);
  const market = useLive((d) => (account && base && account.currency !== base.currency ? marketRate(d, account.currency, base.currency) : null), [account?.currency, base?.currency]);

  const empty: MoneyBackParts = { ready: false, rows: null, amount: null, onKey: () => {}, save: () => {}, valid: false, sheets: null, actionUi: action.ui };
  if (!base) return empty;

  const other = !!account && account.currency !== base.currency;
  const left = dec(base.left).gt(0) ? base.left : '0';
  const accCur = account?.currency ?? base.currency;
  // X = what arrived (account currency); Y = what it counts as (the expense's currency).
  const xPerY = market ? toDecimalString(dec('1').dividedBy(dec(market.rate))) : null;
  const fromY = rateFromYFirst(xPerY);
  const marketShown = market ? trimRate(fromY ? xPerY! : market.rate) : null;
  const defaultAmount = !account ? '' : !other ? left : market ? convert(left, xPerY!, account.currency) : '';
  const amountExpr = amountText ?? defaultAmount;
  const amount = amountExpr ? expressionValue(amountExpr, getCurrency(accCur).minorUnits) : null;
  // Untouched: the amount back is what's expected at today's market rate, it counts as exactly what's
  // expected, and the rate shown is the one those two amounts give — what's on screen is what's saved.
  const rateExpr = rateText ?? '';
  const countsExpr = countsText ?? (other ? left : '');
  const typedRate = expressionValue(rateExpr, RATE_MAX_DECIMALS);
  const typedCounts = expressionValue(countsExpr, getCurrency(base.currency).minorUnits);
  const worked = workOut({ x: amount, known, rate: typedRate, y: typedCounts, curY: base.currency, rateFromY: fromY });
  const countsAs = !other ? amount : worked.y;
  const after = countsAs ? toDecimalString(dec(left).minus(dec(countsAs))) : left;
  const afterStatus = dec(after).lte(0) ? 'reimbursed' : 'partly_back';
  const overRefund = kind === 'refund' && !!countsAs && dec(countsAs).gt(dec(left));
  const valid = !!account && !!amount && dec(amount).gt(0) && !!countsAs && dec(countsAs).gt(0) && !overRefund;

  const onKey = (key: CalcKey) => {
    Keyboard.dismiss();
    const slot = other ? focus : 'amount';
    if (slot === 'amount') setAmountText(pressKey(amountExpr, key, getCurrency(accCur).minorUnits));
    else if (slot === 'rate') setRateText(pressKey(rateExpr, key, RATE_MAX_DECIMALS));
    else setCountsText(pressKey(countsExpr, key, getCurrency(base.currency).minorUnits));
  };
  const onFocus = (slot: TrioSlot) => {
    Keyboard.dismiss();
    setFocus(slot);
    // Tapping the worked-out one makes it the typed one, starting empty.
    if (slot === 'rate' && known !== 'rate') {
      setKnown('rate');
      setRateText('');
    } else if (slot === 'counter' && known !== 'y') {
      setKnown('y');
      setCountsText('');
    }
  };
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
  const amountLabel = (kind === 'refund' ? s.refundAmount : s.amountReceived).toUpperCase();

  const rows = (
    <>
      <SelectorRow label={kind === 'refund' ? s.refundedTo : s.receivedInto} value={account?.name ?? '—'} onPress={() => setPicking(true)} />
      <SelectorRow label={s.date} value={date === today ? s.today(formatLongDate(date)) : formatLongDate(date)} onPress={pickDate} />
      {kind === 'refund' ? <Field label={s.notes} optional value={notes} onChangeText={setNotes} placeholder={s.refundNotesPlaceholder} /> : null}
      <Text style={[styles.small, { color: colors.inkMuted }]}>
        {kind === 'refund'
          ? s.refundExplain
          : account && amount && countsAs
            ? parts(s.gotItExplain(money(amount, account.currency, { fontSize: 11.5 }), account.name, base.category, money(countsAs, base.currency, { fontSize: 11.5 })))
            : null}
      </Text>
    </>
  );

  const amountUi = (
    <>
      {other ? (
        <ConversionTrio
          amount={{ label: amountLabel, currency: accCur, expression: amountExpr, value: amount }}
          rate={{
            from: fromY ? base.currency : accCur,
            to: fromY ? accCur : base.currency,
            expression: rateExpr,
            value: known === 'rate' ? typedRate : worked.rate,
            worked: known !== 'rate',
          }}
          counter={{ label: s.countsAs.toUpperCase(), currency: base.currency, expression: countsExpr, value: countsAs, worked: known !== 'y' }}
          focused={focus}
          onFocus={onFocus}
          onBackspace={() => onKey('back')}
          onClear={() => onKey('clear')}
          market={marketShown}
          onUseMarket={() => {
            setKnown('rate');
            setRateText(marketShown);
            setFocus('rate');
          }}
          vsMarket={(() => {
            const r = known === 'rate' ? typedRate : worked.rate;
            const pct = r && marketShown ? vsMarketPercent(r, fromY ? xPerY : market!.rate) : null;
            return pct ? strings.add.vsMarket(pct) : null;
          })()}
        />
      ) : (
        <AmountBox label={amountLabel} expression={amountExpr} value={amount} currency={accCur} onBackspace={() => onKey('back')} onClear={() => onKey('clear')} />
      )}
      {kind === 'refund' ? (
        <Text style={[styles.hint, { color: overRefund ? colors.expense : colors.inkMuted }]}>{parts(s.refundHint(money(left, base.currency, { fontSize: 11.5 })))}</Text>
      ) : (
        <View style={styles.afterRow}>
          <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.stillExpected}</Text>
          <Text style={[styles.hint, { color: colors.ink }]}>
            {money(dec(after).lt(0) ? '0' : after, base.currency, { fontSize: 12 })} · {s.statuses[afterStatus]}
          </Text>
        </View>
      )}
    </>
  );

  const sheets = (
    <PickerSheet
      visible={picking}
      title={kind === 'refund' ? s.pickRefundedTo : s.pickReceivedInto}
      sections={accountSections}
      selectedId={chosenId}
      onSelect={(id) => {
        setAccountId(id);
        setAmountText(null);
        setRateText(null);
        setCountsText(null);
        setKnown('y');
        setFocus('amount');
      }}
      onClose={() => setPicking(false)}
    />
  );

  return { ready: true, rows, amount: amountUi, onKey, save, valid, sheets, actionUi: action.ui };
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.sans, fontSize: 11.5, paddingHorizontal: 4 },
  afterRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 17 },
  mono: { fontFamily: fonts.monoSemiBold, fontSize: 12 },
});
