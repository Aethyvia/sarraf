import { eq } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { MoneyBackForm } from '@/components/transaction/MoneyBackForm';
import { SharesKeptNote } from '@/components/transaction/SharesKeptNote';
import { TransactionRow } from '@/components/transaction/TransactionRow';
import { Card, Header, Screen } from '@/components/ui';
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
  if (!data) return null;
  return (
    <Screen>
      <Header title={s.refundTitle} onBack={() => router.back()} backIcon="close" />
      <View>
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 6, color: colors.inkMuted }}>{s.beingRefunded}</Text>
        <Card>
          <TransactionRow row={data.row} variant="recent" last />
        </Card>
      </View>
      <SharesKeptNote expenseId={id} />
      {dec(data.left).gt(0) ? (
        <MoneyBackForm parentId={id} kind="refund" onDone={() => router.back()} />
      ) : (
        <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.inkSecondary }}>{s.nothingLeft}</Text>
      )}
    </Screen>
  );
}
