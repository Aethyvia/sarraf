import { isNull } from 'drizzle-orm';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Money } from '@/components/Money';
import { Card, Header } from '@/components/ui';
import { goalTotal } from '@/data/goals';
import { savingsGoals } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { Decimal, dec } from '@/lib/money';
import { useLive } from '@/state/live';
import { fonts, useTheme } from '@/theme';

/** Savings (tab): each goal with what's allocated of its target. Creating and editing goals arrive with layer 7. */
export default function SavingsScreen() {
  const s = strings.savingsTab;
  const { colors } = useTheme();
  const goals = useLive((db) =>
    db
      .select()
      .from(savingsGoals)
      .where(isNull(savingsGoals.archivedAt))
      .orderBy(savingsGoals.priority)
      .all()
      .map((g) => ({ ...g, held: goalTotal(db, g.id) })),
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Header title={s.title} />
        {goals.length === 0 ? <Text style={[styles.note, { color: colors.inkSecondary }]}>{s.empty}</Text> : null}
        {goals.map((g) => {
          const pct = dec(g.targetAmount).gt(0) ? Decimal.min(dec(g.held).dividedBy(dec(g.targetAmount)), 1).times(100).toNumber() : 0;
          return (
            <Card key={g.id} style={styles.card}>
              <Text style={[styles.name, { color: colors.ink }]}>{g.name}</Text>
              <Text style={[styles.meta, { color: colors.inkMuted }]}>
                {g.currency} · {s.priority(g.priority)}
              </Text>
              <View style={[styles.track, { backgroundColor: colors.filled }]}>
                <View style={[styles.fill, { width: `${Math.max(0, pct)}%`, backgroundColor: colors.accent }]} />
              </View>
              <View style={styles.row}>
                <Text style={[styles.meta, { color: colors.inkMuted }]}>{s.allocated}</Text>
                <Text style={[styles.meta, { color: colors.inkMuted }]}>
                  <Money value={g.held} currency={g.currency} style={[styles.amount, { color: colors.ink }]} /> {s.of}{' '}
                  <Money value={g.targetAmount} currency={g.currency} style={[styles.amount, { color: colors.inkMuted }]} />
                </Text>
              </View>
            </Card>
          );
        })}
        <Text style={[styles.note, { color: colors.inkMuted }]}>{s.footer}</Text>
        <Text style={[styles.note, { color: colors.inkMuted }]}>{s.soon}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  card: { padding: 16, gap: 4 },
  name: { fontFamily: fonts.sansSemiBold, fontSize: 15 },
  meta: { fontFamily: fonts.sans, fontSize: 12.5 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 8 },
  fill: { height: '100%', borderRadius: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  amount: { fontFamily: fonts.monoSemiBold, fontSize: 13 },
  note: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 2 },
});
