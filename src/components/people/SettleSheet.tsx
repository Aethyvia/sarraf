import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AmountTextInput } from '@/components/AmountTextInput';
import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { BottomSheet, Button, Field, IconChip, Segmented, SelectorRow, SheetOption, ToggleRow } from '@/components/ui';
import { markSettled, settleInOtherCurrency } from '@/data/owing';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { accounts as accountsTable } from '@/db/schema';
import { useLive } from '@/state/live';
import { isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import type { people } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { dec, parseTypedAmount, toDecimalString } from '@/lib/money';
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
  const toast = useToast();
  const action = useAction();
  const open = balances.filter((b) => !dec(b.balance).isZero());
  const [currency, setCurrency] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState<'full' | 'part'>('full');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  // Paid in another currency: which account the money went into (or came out of), and how much.
  const [other, setOther] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [paidText, setPaidText] = useState('');
  const [pickingAccount, setPickingAccount] = useState(false);
  const allAccounts = useLive((d) => d.select().from(accountsTable).where(isNull(accountsTable.archivedAt)).orderBy(accountsTable.rank).all());

  const chosen = open.find((b) => b.currency === currency) ?? open[0];
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
  const canSave = other ? valid && paidValid : valid;

  const close = () => {
    setText('');
    setNote('');
    setMode('full');
    setCurrency(null);
    setOther(false);
    setAccountId(null);
    setPaidText('');
    onClose();
  };
  const save = () => {
    if (!canSave) return;
    const done = other
      ? action.run(() => settleInOtherCurrency(db, { personId: person.id, currency: chosen.currency, clears: amount!, accountId: account!.id, amount: paid!, note }))
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
        <View style={{ gap: 14 }}>
          {action.ui}
          <View>
            <Text style={[styles.title, { color: colors.ink }]}>{s.title(person.name)}</Text>
            <Text style={[styles.sub, { color: colors.inkMuted }]}>{other ? s.subtitleOther : s.subtitle}</Text>
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
          <View style={styles.afterRow}>
            <Text style={[styles.sub, { color: colors.inkMuted }]}>{owesYou ? s.stillOwes(person.name) : s.youStillOwe}</Text>
 <Money value={after} currency={chosen.currency} sign={dec(after).isZero() ? 'auto' : 'always'} style={[styles.mono, { fontSize: 12, color: tone(after) }]} />
          </View>
          {otherAccounts.length ? (
            <ToggleRow
              title={s.otherCurrency}
              detail={s.otherCurrencyDetail(person.name)}
              value={other}
              onChange={(v) => {
                setOther(v);
                if (v && !accountId) setAccountId(otherAccounts[0]?.id ?? null);
              }}
            />
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
          <Text style={[styles.small, { color: colors.inkMuted }]}>{other ? s.explainOther(person.name) : s.explain(person.name)}</Text>
          <Button
            label={valid ? parts(s.save(<Money value={amount!} currency={chosen.currency} style={[styles.mono, { fontSize: 13.5, color: colors.onAccent }]} />)) : strings.people.markSettled}
            disabled={!canSave}
            onPress={save}
          />
        </View>
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
