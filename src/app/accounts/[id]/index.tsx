import { eq } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { DeleteInUseSheet } from '@/components/sheets/DeleteInUseSheet';
import { Button, Card, Header, IconChip, LinkButton, Screen } from '@/components/ui';
import {
  accountDeletionImpact,
  archiveAccount,
  deleteAccount,
  setAsideByGoal,
  unarchiveAccount,
} from '@/data/accounts';
import { accountBalance } from '@/data/balances';
import { db } from '@/db/client';
import { accounts } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { add } from '@/lib/money';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { usePlan } from '@/state/plan';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Account detail: balance and the currency goals line. Usable is per currency
 * and lives on Home only. Add transaction, Fix balance, the trend line and the
 * transaction list arrive with build layer 4.
 */
export default function AccountDetailScreen() {
  const s = strings.accounts;
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const plan = usePlan();
  const [deleting, setDeleting] = useState(false);
  const data = useLive(
    (d) => {
      const account = d.select().from(accounts).where(eq(accounts.id, id)).get();
      if (!account) return null;
      return { account, balance: accountBalance(d, id), setAside: setAsideByGoal(d, id) };
    },
    [id],
  );
  const action = useAction({ itemName: data?.account.name });
  const impact = useLive((d) => (deleting ? accountDeletionImpact(d, id) : null), [deleting, id]);

  if (!data) return null;
  const { account, balance, setAside } = data;
  const setAsideTotal = setAside.length ? add(...setAside.map((g) => g.amount)) : null;

  return (
    <Screen>
      <Header title={account.name} subtitle={account.currency} onBack={() => router.back()} />
      {action.ui}

      <Card style={styles.balanceCard}>
        <IconChip icon={account.icon} color={account.color} size={40} />
        <Text style={[styles.balanceLabel, { color: colors.inkMuted }]}>{s.balance}</Text>
        <Money value={balance} currency={account.currency} style={styles.balance} />
      </Card>

      {account.archivedAt ? (
        <Text style={[styles.notice, { color: colors.inkSecondary, backgroundColor: colors.filled }]}>{s.archivedNotice}</Text>
      ) : null}

      {setAsideTotal ? (
        <View style={[styles.goals, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Icon name="piggy" size={16} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.goalsText, { color: colors.ink }]}>
              <Money value={setAsideTotal} currency={account.currency} style={{ fontSize: 12.5 }} /> {s.setAside}
            </Text>
            <Text style={[styles.goalsDetail, { color: colors.inkMuted }]}>
              {s.setAsideGoals(setAside.map((g) => g.goalName).join(', '), account.currency)}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.buttons}>
        {!account.archivedAt ? (
          <Button label={strings.add.title} onPress={() => router.push({ pathname: '/transaction/new', params: { accountId: id } })} style={{ flex: 1.4 }} />
        ) : null}
        <Button kind="secondary" label={strings.common.edit} onPress={() => router.push(`/accounts/${id}/edit`)} style={{ flex: 1 }} />
      </View>

      {account.archivedAt ? (
        <Button kind="secondary" label={strings.common.unarchive} onPress={() => action.run(() => unarchiveAccount(db, id, plan))} />
      ) : (
        <Button kind="danger" label={s.archive} onPress={() => action.run(() => archiveAccount(db, id))} />
      )}
      <LinkButton danger label={s.delete} onPress={() => setDeleting(true)} />

      {impact ? (
        <DeleteInUseSheet
          visible={deleting}
          kind="account"
          name={account.name}
          impact={impact}
          archiveNote={
            !account.archivedAt ? (
              <Text style={[styles.archiveNote, { color: colors.inkMuted }]}>
                <Money value={balance} currency={account.currency} style={{ fontSize: 12.5 }} /> · {strings.deleteInUse.moveBalanceSoon}
              </Text>
            ) : null
          }
          onArchive={
            account.archivedAt
              ? undefined
              : () => {
                  setDeleting(false);
                  action.run(() => archiveAccount(db, id));
                }
          }
          onDelete={() => {
            setDeleting(false);
            if (action.run(() => deleteAccount(db, id))) router.back();
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceCard: { alignItems: 'center', padding: 18, gap: 6 },
  balanceLabel: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.5, marginTop: 6 },
  balance: { fontFamily: fonts.monoSemiBold, fontSize: 30 },
  notice: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, borderRadius: radius.field, padding: 12 },
  goals: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.field, paddingHorizontal: 13, paddingVertical: 10 },
  goalsText: { fontFamily: fonts.sans, fontSize: 12.5 },
  goalsDetail: { fontFamily: fonts.sans, fontSize: 11 },
  buttons: { flexDirection: 'row', gap: 10 },
  archiveNote: { fontFamily: fonts.sans, fontSize: 12, marginTop: 4 },
});
