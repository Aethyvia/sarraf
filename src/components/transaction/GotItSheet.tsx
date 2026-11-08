import { eq } from 'drizzle-orm';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { BottomSheet, Button, LinkButton } from '@/components/ui';
import { writeOff } from '@/data/money-back';
import { chargedCurrencyOf, outstandingOf } from '@/data/owing';
import { db } from '@/db/client';
import { people, transactions } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { toDecimalString } from '@/lib/money';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { useToast } from '@/state/toast';
import { fonts, useTheme } from '@/theme';
import { MoneyBackForm } from './MoneyBackForm';

/** Got it (Spec §10, §15): money back on a reimbursable expense, or Write off the rest. */
export function GotItSheet({ expenseId, onClose }: { expenseId: string | null; onClose: () => void }) {
  const s = strings.moneyBack;
  const { colors } = useTheme();
  const toast = useToast();
  const action = useAction();
  const [confirmingWriteOff, setConfirmingWriteOff] = useState(false);
  const info = useLive(
    (d) => {
      if (!expenseId) return null;
      const t = d.select().from(transactions).where(eq(transactions.id, expenseId)).get();
      if (!t) return null;
      const person = t.expectedFromPersonId ? (d.select({ name: people.name }).from(people).where(eq(people.id, t.expectedFromPersonId)).get()?.name ?? null) : null;
      return { t, person, currency: chargedCurrencyOf(d, t), left: toDecimalString(outstandingOf(d, t).outstanding) };
    },
    [expenseId],
  );
  const close = () => {
    setConfirmingWriteOff(false);
    onClose();
  };
  const title = info ? (info.t.notes?.split('\n')[0] ?? '') : '';
  const left = info ? <Money value={info.left} currency={info.currency} allowCompact={false} style={styles.mono} /> : null;

  return (
    <BottomSheet visible={!!expenseId && !!info} onClose={close} title={confirmingWriteOff ? s.writeOffTitle : s.gotItTitle}>
      {info && confirmingWriteOff ? (
        <View style={{ gap: 12 }}>
          {action.ui}
          <Text style={[styles.body, { color: colors.inkSecondary }]}>{parts(s.writeOffBody(left))}</Text>
          <Button
            label={s.writeOffConfirm}
            style={{ backgroundColor: colors.expense }}
            onPress={() => {
              if (action.run(() => (writeOff(db, info.t.id), true))) {
                toast({ message: s.wroteOff });
                close();
              }
            }}
          />
          <Button kind="secondary" label={strings.common.cancel} onPress={() => setConfirmingWriteOff(false)} />
        </View>
      ) : info ? (
        <View style={{ gap: 12 }}>
          <Text style={[styles.sub, { color: colors.inkMuted }]}>{parts(s.expectedFrom(title || s.uncategorized, left, info.person))}</Text>
          <MoneyBackForm parentId={info.t.id} kind="reimbursement" onDone={close} />
          <LinkButton danger label={s.writeOff} onPress={() => setConfirmingWriteOff(true)} />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sub: { fontFamily: fonts.sans, fontSize: 12.5, marginTop: -6 },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  mono: { fontFamily: fonts.monoSemiBold, fontSize: 12.5 },
});
