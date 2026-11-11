import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AmountTextInput } from '@/components/AmountTextInput';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { formatLongDate } from '@/components/transaction/parts';
import { BottomSheet, Button, SelectorRow } from '@/components/ui';
import { accountBalance } from '@/data/balances';
import { fixBalance, pendingOnAccount } from '@/data/transaction-ops';
import { db } from '@/db/client';
import type { accounts } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { today as todayDate } from '@/lib/dates';
import { dec, parseTypedAmount, toDecimalString } from '@/lib/money';
import { useAction } from '@/state/actions';
import { useSettings } from '@/state/settings';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Fix balance (Spec — Decided): type what the bank shows; Sarraf adds a dated
 * Balance adjustment for the difference. Not income or spending; the opening
 * balance stays as it was.
 */
export function FixBalanceSheet({ account, visible, onClose }: { account: typeof accounts.$inferSelect; visible: boolean; onClose: () => void }) {
  const s = strings.fixBalance;
  const { colors } = useTheme();
  const { numberFormat } = useSettings();
  const toast = useToast();
  const action = useAction();
  const today = todayDate();
  const [text, setText] = useState('');
  const [date, setDate] = useState(today);

  const institution = account.institution ?? account.name;
  const current = accountBalance(db, account.id, date);
  const shows = text.trim() ? parseTypedAmount(text, numberFormat) : null;
  const difference = shows ? toDecimalString(dec(shows).minus(dec(current))) : null;
  const pending = visible ? pendingOnAccount(db, account.id) : 0;
  const amount = (v: string, sign: 'always' | 'auto' = 'auto') => <Money value={v} currency={account.currency} sign={sign} style={styles.inline} />;

  const pickDate = () => {
    const [y, m, d] = date.split('-').map(Number);
    DateTimePickerAndroid.open({
      value: new Date(y, m - 1, d),
      mode: 'date',
      maximumDate: new Date(),
      onChange: (e, picked) => e.type === 'set' && picked && setDate(todayDate(picked)),
    });
  };
  const close = () => {
    setText('');
    setDate(today);
    onClose();
  };
  const save = () => {
    if (!shows) return;
    const done = action.run(() => fixBalance(db, account.id, shows, date));
    if (done) {
      toast({ message: s.done });
      close();
    }
  };

  return (
    <BottomSheet visible={visible} onClose={close} title={s.title}>
      <View style={{ gap: 14 }}>
        {action.ui}
        <Text style={[styles.sub, { color: colors.inkMuted }]}>{parts(s.shows(account.name, amount(current)))}</Text>
        <View>
          <Text style={[styles.label, { color: colors.inkMuted }]}>{s.whatShows(institution)}</Text>
          <View style={[styles.input, { backgroundColor: colors.filled }]}>
            <Text style={[styles.code, { color: colors.inkMuted }]}>{account.currency}</Text>
            <AmountTextInput
              value={text}
              onChangeText={setText}
              keyboardType="numeric"
              autoFocus
              placeholder={current}
              placeholderTextColor={colors.inkMuted}
              style={[styles.amount, { color: colors.ink }]}
            />
          </View>
          {difference && !dec(difference).isZero() ? (
            <Text style={[styles.diff, { color: colors.inkSecondary }]}>
              {s.difference}{' '}
              <Money value={difference} currency={account.currency} sign="always" style={[styles.inline, { color: dec(difference).isNegative() ? colors.expense : colors.income }]} />
            </Text>
          ) : null}
        </View>
        <SelectorRow label={s.date} value={date === today ? s.today(formatLongDate(date)) : formatLongDate(date)} onPress={pickDate} />
        {pending > 0 ? <Text style={[styles.note, { color: colors.warning, backgroundColor: colors.warningSoft }]}>{s.pending(pending, institution)}</Text> : null}
        {difference && !dec(difference).isZero() ? (
          <Text style={[styles.small, { color: colors.inkMuted }]}>{parts(s.explain(amount(difference, 'always')))}</Text>
        ) : null}
        <Button
          label={shows ? parts(s.setTo(<Money value={shows} currency={account.currency} style={[styles.inline, { fontSize: 13.5, color: colors.onAccent }]} />)) : s.title} disabled={!difference || dec(difference).isZero()} onPress={save} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sub: { fontFamily: fonts.sans, fontSize: 12.5, marginTop: -8 },
  inline: { fontFamily: fonts.monoSemiBold, fontSize: 12.5 },
  label: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 6 },
  input: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.field, paddingHorizontal: 14 },
  code: { fontFamily: fonts.sansBold, fontSize: 13 },
  amount: { flex: 1, fontFamily: fonts.monoSemiBold, fontSize: 22, paddingVertical: 10 },
  diff: { fontFamily: fonts.sans, fontSize: 12.5, marginTop: 6 },
  note: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, borderRadius: radius.field, padding: 10 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
});
