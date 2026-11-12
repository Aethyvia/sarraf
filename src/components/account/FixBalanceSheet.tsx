import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AmountBox } from '@/components/AmountBox';
import { Keypad } from '@/components/Keypad';
import { useAmountField } from '@/components/KeypadScreen';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { formatLongDate } from '@/components/transaction/parts';
import { BottomSheet, SelectorRow } from '@/components/ui';
import { accountBalance } from '@/data/balances';
import { fixBalance, pendingOnAccount } from '@/data/transaction-ops';
import { db } from '@/db/client';
import type { accounts } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { today as todayDate } from '@/lib/dates';
import { dec, getCurrency, toDecimalString } from '@/lib/money';
import { useAction } from '@/state/actions';
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
  const toast = useToast();
  const action = useAction();
  const today = todayDate();
  // Typed on Sarraf's keypad inside the sheet (pattern B1, Owner Nov 12); ✓ beside the title saves.
  const field = useAmountField('', getCurrency(account.currency).minorUnits);
  const [date, setDate] = useState(today);

  const institution = account.institution ?? account.name;
  const current = accountBalance(db, account.id, date);
  const shows = field.value;
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
    field.clear();
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
    <BottomSheet
      visible={visible}
      onClose={close}
      title={s.title}
      onDone={save}
      doneDisabled={!difference || dec(difference).isZero()}
      doneLabel={s.title}
    >
      <View style={{ gap: 10 }}>
        {action.ui}
        <Text style={[styles.sub, { color: colors.inkMuted }]}>{parts(s.shows(account.name, amount(current)))}</Text>
        <SelectorRow label={s.date} value={date === today ? s.today(formatLongDate(date)) : formatLongDate(date)} onPress={pickDate} />
        {pending > 0 ? <Text style={[styles.note, { color: colors.warning, backgroundColor: colors.warningSoft }]}>{s.pending(pending, institution)}</Text> : null}
        <AmountBox
          label={s.whatShows(institution)}
          expression={field.expression}
          value={field.value}
          currency={account.currency}
          onBackspace={field.back}
          onClear={field.clear}
        />
        {difference && !dec(difference).isZero() ? (
          <View style={styles.diffRow}>
            <Text style={[styles.small, { color: colors.inkSecondary, flex: 1 }]}>{s.adjustmentLine}</Text>
            <Money value={difference} currency={account.currency} sign="always" style={[styles.inline, { color: dec(difference).isNegative() ? colors.expense : colors.income }]} />
          </View>
        ) : null}
        <Keypad onKey={field.press} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sub: { fontFamily: fonts.sans, fontSize: 12.5, marginTop: -8 },
  inline: { fontFamily: fonts.monoSemiBold, fontSize: 12.5 },
  note: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, borderRadius: radius.field, padding: 10 },
  diffRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
});
