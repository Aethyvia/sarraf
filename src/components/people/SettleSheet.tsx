import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AmountTextInput } from '@/components/AmountTextInput';
import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { BottomSheet, Button, Field, IconChip, Segmented, SelectorRow, SheetOption } from '@/components/ui';
import { markSettled, offsetBalances, settleInOtherCurrency } from '@/data/owing';
import { marketRate } from '@/data/rates';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { accounts as accountsTable } from '@/db/schema';
import { useLive } from '@/state/live';
import { isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import type { people } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { convert, dec, parseTypedAmount, roundToMinor, toDecimalString } from '@/lib/money';
import { useAction } from '@/state/actions';
import { useSettings } from '@/state/settings';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Mark as settled (Spec §9e): pick the currency, then the full amount or part
 * of it, plus an optional note. Only the person's balance changes.
 */
export function SettleSheet({
  visible,
  person,
  balances,
  onClose,
}: {
  visible: boolean;
  person: typeof people.$inferSelect;
  balances: { currency: string; balance: string }[];
  onClose: () => void;
}) {
  const s = strings.settle;
  const { colors } = useTheme();
  const { numberFormat } = useSettings();
  // The sheet scrolls once its choices outgrow the screen.
  const { height } = useWindowDimensions();
  const toast = useToast();
  const action = useAction();
  const open = balances.filter((b) => !dec(b.balance).isZero());
  const [currency, setCurrency] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState<'full' | 'part'>('full');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  // How it was settled: outside Sarraf (balance only), paid in another currency (money moves),
  // or set against a balance in another currency that owes the other way (Decided Nov 12).
  const [how, setHow] = useState<'outside' | 'paid' | 'offset'>('outside');
  const other = how === 'paid';
  const [againstCurrency, setAgainstCurrency] = useState<string | null>(null);
  const [rateText, setRateText] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [paidText, setPaidText] = useState('');
  const [pickingAccount, setPickingAccount] = useState(false);
  const allAccounts = useLive((d) => d.select().from(accountsTable).where(isNull(accountsTable.archivedAt)).orderBy(accountsTable.rank).all());

  const chosen = open.find((b) => b.currency === currency) ?? open[0];
  // Today's market rate between the two balances, as the starting rate for "Against …" (looked up before any early return).
  const againstPick = chosen
    ? (open.filter((b) => b.currency !== chosen.currency && dec(b.balance).isPositive() !== dec(chosen.balance).isPositive()).find((b) => b.currency === againstCurrency) ??
      open.find((b) => b.currency !== chosen.currency && dec(b.balance).isPositive() !== dec(chosen.balance).isPositive()) ??
      null)
    : null;
  const market = useLive((d) => (chosen && againstPick ? marketRate(d, chosen.currency, againstPick.currency) : null), [chosen?.currency, againstPick?.currency]);
  if (!chosen) return null;
  const owesYou = dec(chosen.balance).isPositive();
  const full = toDecimalString(dec(chosen.balance).abs());
  const amount = mode === 'full' ? full : text.trim() ? parseTypedAmount(text, numberFormat) : null;
  const valid = !!amount && dec(amount).gt(0) && dec(amount).lte(dec(full));
  const after = valid ? toDecimalString(owesYou ? dec(chosen.balance).minus(dec(amount!)) : dec(chosen.balance).plus(dec(amount!))) : chosen.balance;
  const tone = (v: string) => (dec(v).isNegative() ? colors.expense : dec(v).isZero() ? colors.inkMuted : colors.income);
  const otherAccounts = allAccounts.filter((a) => a.currency !== chosen.currency);
  const account = otherAccounts.find((a) => a.id === accountId) ?? null;
  const paid = paidText.trim() ? parseTypedAmount(paidText, numberFormat) : null;
  const paidValid = !!paid && dec(paid).gt(0) && !!account;
  // The rate they got, shown like any conversion: paid ÷ what it clears.
  // Like rates elsewhere: at least 2 decimals, at most 6, no trailing zeros past 2 (278.00, 0.003597).
  const rate = valid && paidValid ? dec(paid!).div(dec(amount!)).toDecimalPlaces(6).toFixed(Math.max(2, Math.min(6, dec(paid!).div(dec(amount!)).toDecimalPlaces(6).decimalPlaces()))) : null;
  // Against another balance: the currencies owing the other way, the rate, and how much of each clears.
  const opposite = open.filter((b) => b.currency !== chosen.currency && dec(b.balance).isPositive() !== owesYou);
  const against = opposite.find((b) => b.currency === againstCurrency) ?? opposite[0] ?? null;
  // Rates read from the stronger currency (1 EUR = 307.75 PKR, not 1 PKR = 0.0032 EUR): flip when the market rate is below 1.
  const flipped = !!market && dec(market.rate).lt(1);
  const shownMarket = market ? (flipped ? dec('1').div(dec(market.rate)).toDecimalPlaces(2).toFixed(2) : market.rate) : null;
  const typedRate = rateText.trim() ? parseTypedAmount(rateText, numberFormat) : null;
  const offsetRate = typedRate
    ? flipped
      ? dec(typedRate).gt(0)
        ? toDecimalString(dec('1').div(dec(typedRate)))
        : null
      : typedRate
    : (market?.rate ?? null);
  const offset = (() => {
    if (how !== 'offset' || !against || !offsetRate || dec(offsetRate).lte(0) || !valid) return null;
    const room = dec(against.balance).abs();
    // As much as asked, but never more than the other balance: then the other side clears in full.
    let clears = dec(amount!);
    let other = dec(convert(amount!, offsetRate, against.currency));
    if (other.gt(room)) {
      other = room;
      clears = dec(roundToMinor(toDecimalString(room.div(dec(offsetRate))), chosen.currency));
    }
    if (clears.lte(0) || other.lte(0)) return null;
    return { clears: toDecimalString(clears), other: toDecimalString(other) };
  })();
  const afterOffset = (b: { balance: string }, by: string | undefined) =>
    by ? toDecimalString(dec(b.balance).isPositive() ? dec(b.balance).minus(dec(by)) : dec(b.balance).plus(dec(by))) : b.balance;
  const canSave = how === 'paid' ? valid && paidValid : how === 'offset' ? !!offset : valid;

  const close = () => {
    setText('');
    setNote('');
    setMode('full');
    setCurrency(null);
    setHow('outside');
    setAgainstCurrency(null);
    setRateText('');
    setAccountId(null);
    setPaidText('');
    onClose();
  };
  const save = () => {
    if (!canSave) return;
    const done =
      how === 'paid'
        ? action.run(() => settleInOtherCurrency(db, { personId: person.id, currency: chosen.currency, clears: amount!, accountId: account!.id, amount: paid!, note }))
        : how === 'offset'
          ? action.run(() =>
              offsetBalances(db, { personId: person.id, a: { currency: chosen.currency, amount: offset!.clears }, b: { currency: against!.currency, amount: offset!.other }, note }),
            )
          : action.run(() => markSettled(db, { personId: person.id, currency: chosen.currency, amount: amount!, note }));
    if (done) {
      toast({ message: s.done });
      close();
    }
  };

  return (
    <BottomSheet visible={visible} onClose={close}>
      {picking ? (
        <View>
          <Text style={[styles.title, { color: colors.ink }]}>{s.pickCurrency}</Text>
          {open.map((b) => (
            <SheetOption
              key={b.currency}
              title={dec(b.balance).isPositive() ? s.owesYou(b.currency, person.name) : s.youOwe(b.currency)}
              trailing={<Money value={b.balance} currency={b.currency} sign="always" style={[styles.mono, { color: tone(b.balance) }]} />}
              selected={b.currency === chosen.currency}
              onPress={() => {
                setCurrency(b.currency);
                setText('');
                setPicking(false);
              }}
            />
          ))}
        </View>
      ) : (
        <ScrollView style={{ maxHeight: height * 0.82 }} contentContainerStyle={{ gap: 14, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
          {action.ui}
          <View>
            <Text style={[styles.title, { color: colors.ink }]}>{s.title(person.name)}</Text>
            <Text style={[styles.sub, { color: colors.inkMuted }]}>{how === 'paid' ? s.subtitleOther : s.subtitle}</Text>
          </View>
          <View>
            <Text style={[styles.label, { color: colors.inkMuted }]}>{s.currency}</Text>
            <Pressable
              onPress={open.length > 1 ? () => setPicking(true) : undefined}
              disabled={open.length < 2}
              style={[styles.currencyRow, { backgroundColor: colors.filled }]}
            >
              <Text style={[styles.currencyText, { color: colors.ink }]}>{owesYou ? s.owesYou(chosen.currency, person.name) : s.youOwe(chosen.currency)}</Text>
              <Money value={chosen.balance} currency={chosen.currency} sign="always" style={[styles.mono, { color: tone(chosen.balance) }]} />
              {open.length > 1 ? <Icon name="down" size={12} color={colors.inkMuted} strokeWidth={2.2} /> : null}
            </Pressable>
          </View>
          <Segmented
            options={[
              { value: 'full', label: s.full },
              { value: 'part', label: s.part },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === 'part' ? (
            <View>
              <Text style={[styles.label, { color: colors.inkMuted }]}>{s.amount}</Text>
              <View style={[styles.amountBox, { borderColor: colors.accent, backgroundColor: colors.surface }]}>
                <Text style={[styles.code, { color: colors.inkSecondary }]}>{chosen.currency}</Text>
                <AmountTextInput value={text} onChangeText={setText} keyboardType="numeric" autoFocus placeholder="0.00" placeholderTextColor={colors.inkMuted} style={[styles.amountInput, { color: colors.ink }]} />
              </View>
            </View>
          ) : null}
          <View style={[styles.afterRow, how === 'offset' && { display: 'none' }]}>
            <Text style={[styles.sub, { color: colors.inkMuted }]}>{owesYou ? s.stillOwes(person.name) : s.youStillOwe}</Text>
 <Money value={after} currency={chosen.currency} sign={dec(after).isZero() ? 'auto' : 'always'} style={[styles.mono, { fontSize: 12, color: tone(after) }]} />
          </View>
          <View>
            <Text style={[styles.label, { color: colors.inkMuted }]}>{s.how}</Text>
            <SheetOption title={s.howOutside} detail={s.howOutsideDetail(person.name)} selected={how === 'outside'} onPress={() => setHow('outside')} />
            {otherAccounts.length ? (
              <SheetOption
                title={s.otherCurrency}
                detail={s.otherCurrencyDetail(person.name)}
                selected={how === 'paid'}
                onPress={() => {
                  setHow('paid');
                  if (!accountId) setAccountId(otherAccounts[0]?.id ?? null);
                }}
              />
            ) : null}
            {opposite.length ? (
              <SheetOption
                title={s.howOffset(against!.currency)}
                detail={owesYou ? s.howOffsetDetailYouOweThem(person.name, against!.currency) : s.howOffsetDetailTheyOweYou(person.name, against!.currency)}
                selected={how === 'offset'}
                onPress={() => setHow('offset')}
              />
            ) : null}
          </View>
          {how === 'offset' && against ? (
            <>
              {opposite.length > 1 ? (
                <Segmented options={opposite.map((b) => ({ value: b.currency, label: b.currency }))} value={against.currency} onChange={(c) => (setAgainstCurrency(c), setRateText(''))} />
              ) : null}
              <Field
                label={flipped ? s.offsetRate(against.currency, chosen.currency) : s.offsetRate(chosen.currency, against.currency)}
                value={rateText}
                onChangeText={setRateText}
                keyboardType="decimal-pad"
                placeholder={shownMarket ?? '0.00'}
              />
              {market && !rateText.trim() ? <Text style={[styles.small, { color: colors.inkMuted, marginTop: -8 }]}>{s.offsetMarket}</Text> : null}
              {offset ? (
                <View style={{ gap: 4 }}>
                  <View style={styles.afterRow}>
                    <Text style={[styles.sub, { color: colors.inkMuted }]}>{s.balanceAfter(person.name, chosen.currency)}</Text>
                    <Money value={afterOffset(chosen, offset.clears)} currency={chosen.currency} sign={dec(afterOffset(chosen, offset.clears)).isZero() ? 'auto' : 'always'} style={[styles.mono, { fontSize: 12, color: tone(afterOffset(chosen, offset.clears)) }]} />
                  </View>
                  <View style={styles.afterRow}>
                    <Text style={[styles.sub, { color: colors.inkMuted }]}>{s.balanceAfter(person.name, against.currency)}</Text>
                    <Money value={afterOffset(against, offset.other)} currency={against.currency} sign={dec(afterOffset(against, offset.other)).isZero() ? 'auto' : 'always'} style={[styles.mono, { fontSize: 12, color: tone(afterOffset(against, offset.other)) }]} />
                  </View>
                </View>
              ) : null}
            </>
          ) : null}
          {other ? (
            <>
              <SelectorRow
                label={owesYou ? s.into : s.outOf}
                value={account?.name ?? s.pickAccount}
                leading={account ? <IconChip icon={account.icon} color={account.color} size={28} /> : undefined}
                onPress={() => setPickingAccount(true)}
              />
              {account ? (
                <View>
                  <Text style={[styles.label, { color: colors.inkMuted }]}>{s.paidAmount(account.currency)}</Text>
                  <View style={[styles.amountBox, { borderColor: colors.accent, backgroundColor: colors.surface }]}>
                    <Text style={[styles.code, { color: colors.inkSecondary }]}>{account.currency}</Text>
                    <AmountTextInput value={paidText} onChangeText={setPaidText} keyboardType="numeric" placeholder="0.00" placeholderTextColor={colors.inkMuted} style={[styles.amountInput, { color: colors.ink }]} />
                  </View>
                  {rate ? <Text style={[styles.rate, { color: colors.inkSecondary }]}>{s.rate(chosen.currency, rate, account.currency)}</Text> : null}
                </View>
              ) : null}
              {account && paidValid ? (
                <View style={styles.afterRow}>
                  <Text style={[styles.sub, { color: colors.inkMuted }]}>{owesYou ? s.accountUp(account.name) : s.accountDown(account.name)}</Text>
                  <Money value={paid!} currency={account.currency} style={[styles.mono, { fontSize: 12, color: owesYou ? colors.income : colors.expense }]} />
                </View>
              ) : null}
            </>
          ) : null}
          <Field label={s.note.replace(' (OPTIONAL)', '')} optional value={note} onChangeText={setNote} placeholder={s.notePlaceholder} />
          <Text style={[styles.small, { color: colors.inkMuted }]}>{how === 'paid' ? s.explainOther(person.name) : how === 'offset' ? s.explainOffset : s.explain(person.name)}</Text>
          <Button
            label={
              valid
                ? parts(s.save(<Money value={how === 'offset' && offset ? offset.clears : amount!} currency={chosen.currency} style={[styles.mono, { fontSize: 13.5, color: colors.onAccent }]} />))
                : strings.people.markSettled
            }
            disabled={!canSave}
            onPress={save}
          />
        </ScrollView>
      )}
      <PickerSheet
        visible={pickingAccount}
        title={owesYou ? s.into.charAt(0) + s.into.slice(1).toLowerCase() : s.outOf.charAt(0) + s.outOf.slice(1).toLowerCase()}
        sections={[{ items: otherAccounts.map((a) => ({ id: a.id, title: a.name, detail: a.currency, leading: <IconChip icon={a.icon} color={a.color} size={30} /> })) }]}
        selectedId={accountId}
        onSelect={(id) => {
          setAccountId(id);
          setPaidText('');
        }}
        onClose={() => setPickingAccount(false)}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.serif, fontSize: 19 },
  sub: { fontFamily: fonts.sans, fontSize: 12.5, marginTop: 2 },
  label: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 5 },
  currencyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.field, paddingHorizontal: 14, paddingVertical: 11 },
  currencyText: { flex: 1, fontFamily: fonts.sansSemiBold, fontSize: 14 },
  mono: { fontFamily: fonts.monoSemiBold, fontSize: 14 },
  amountBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: radius.field, paddingHorizontal: 14 },
  code: { fontFamily: fonts.sansBold, fontSize: 11 },
  amountInput: { flex: 1, fontFamily: fonts.mono, fontSize: 17, paddingVertical: 10 },
  afterRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2, marginTop: -6 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 17 },
  rate: { fontFamily: fonts.mono, fontSize: 12, marginTop: 6, paddingHorizontal: 2 },
});
