import { goBack } from '@/state/nav';
import { eq } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { KeypadScreen } from '@/components/KeypadScreen';
import { useMoneyBack } from '@/components/transaction/MoneyBackForm';
import { SharesKeptNote } from '@/components/transaction/SharesKeptNote';
import { TransactionRow } from '@/components/transaction/TransactionRow';
import { Card, Header, IconButton, Screen } from '@/components/ui';
import { refundableLeft } from '@/data/money-back';
import { toListRowFromDb } from '@/data/transaction-list';
import { transactions } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { dec } from '@/lib/money';
import { useLive } from '@/state/live';
import { fonts, useTheme } from '@/theme';

/** Add refund (Spec §15a): money back on an expense, added when it arrives; never income, never in Needs review. */
export default function AddRefundScreen() {
  const s = strings.moneyBack;
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const data = useLive(
    (d) => {
      const t = d.select().from(transactions).where(eq(transactions.id, id)).get();
      return t ? { row: toListRowFromDb(d, t), left: refundableLeft(d, id).amount } : null;
    },
    [id],
  );
  const form = useMoneyBack(id, 'refund', () => router.back());
  if (!data) return null;
  const refunded = (
    <>
      <View>
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 6, color: colors.inkMuted }}>{s.beingRefunded}</Text>
        <Card>
          <TransactionRow row={data.row} variant="recent" last />
        </Card>
      </View>
      <SharesKeptNote expenseId={id} />
    </>
  );
  if (!dec(data.left).gt(0) || !form.ready) {
    return (
      <Screen>
        <Header title={s.refundTitle} onBack={goBack} backIcon="close" />
        {refunded}
        <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.inkSecondary }}>{s.nothingLeft}</Text>
      </Screen>
    );
  }
  // Pattern A (Owner, Nov 12): rows on top, the amount(s) docked above Sarraf's keypad, ✓ saves.
  return (
    <KeypadScreen
      header={
        <>
          <Header title={s.refundTitle} onBack={goBack} backIcon="close" actions={<IconButton icon="tick" filled label={s.saveRefund} onPress={form.save} disabled={!form.valid} />} />
          {form.actionUi}
        </>
      }
      onKey={form.onKey}
      amount={form.amount}
    >
      {refunded}
      {form.rows}
      {form.sheets}
    </KeypadScreen>
  );
}
