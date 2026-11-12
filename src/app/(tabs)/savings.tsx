import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { Button, Card, IconButton } from '@/components/ui';
import { goalTotal } from '@/data/goals';
import { savingsGoals } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { Decimal, dec } from '@/lib/money';
import { useLive } from '@/state/live';
import { fonts, useTheme } from '@/theme';

/** Savings (tab): each goal with what's allocated of its target, by priority; completed goals below. */
export default function SavingsScreen() {
  const s = strings.savingsTab;
  const g = strings.goals;
  const { colors } = useTheme();
  const goals = useLive((db) =>
    db
      .select()
      .from(savingsGoals)
      .orderBy(savingsGoals.priority)
      .all()
      .map((x) => ({ ...x, held: goalTotal(db, x.id) })),
  );
  // Archived goals (e.g. when Sarraf Plus ended) are listed last so they can come back.
  const archived = goals.filter((x) => x.archivedAt);
  const open = goals.filter((x) => !x.completedAt && !x.archivedAt);
  const done = goals.filter((x) => x.completedAt && !x.archivedAt);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.ink }]}>{s.title}</Text>
          <IconButton icon="settings" label={strings.settings.title} onPress={() => router.push('/settings')} />
        </View>
        {open.length + done.length === 0 && archived.length === 0 ? (
          <Card style={styles.empty}>
            <Icon name="piggy" size={30} color={colors.border} strokeWidth={1.6} />
            <Text style={[styles.emptyTitle, { color: colors.inkSecondary }]}>{g.emptyTitle}</Text>
            <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>{g.emptyBody}</Text>
          </Card>
        ) : null}
        {[...open, ...done, ...archived].map((x) => {
          const pct = dec(x.targetAmount).gt(0) ? Decimal.min(dec(x.held).dividedBy(dec(x.targetAmount)), 1).times(100).toNumber() : 0;
          return (
            <Pressable key={x.id} onPress={() => router.push(`/goals/${x.id}`)} accessibilityRole="button">
              <Card style={[styles.card, x.completedAt || x.archivedAt ? { opacity: 0.6 } : null]}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: colors.ink }]}>{x.name}</Text>
                    <Text style={[styles.meta, { color: colors.inkMuted }]}>{x.archivedAt ? `${x.currency} · ${g.archived}` : x.completedAt ? `${x.currency} · ${g.completed}` : `${x.currency} · ${s.priority(x.priority)}`}</Text>
                  </View>
                  <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} />
                </View>
                <View style={[styles.track, { backgroundColor: colors.filled }]}>
                  <View style={[styles.fill, { width: `${Math.max(0, pct)}%`, backgroundColor: colors.accent }]} />
                </View>
                <View style={styles.row}>
                  <Text style={[styles.meta, { color: colors.inkMuted }]}>{s.allocated}</Text>
                  <Text style={[styles.meta, { color: colors.inkMuted }]}>
                    <Money value={x.held} currency={x.currency} style={[styles.amount, { color: colors.ink }]} /> {s.of}{' '}
                    <Money value={x.targetAmount} currency={x.currency} style={[styles.amount, { color: colors.inkMuted }]} />
                  </Text>
                </View>
              </Card>
            </Pressable>
          );
        })}
        <Button kind="dashed" label={g.addDashed} onPress={() => router.push('/goals/new')} />
        {goals.length ? <Text style={[styles.note, { color: colors.inkMuted }]}>{s.footer}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.serif, fontSize: 22 },
  card: { padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  name: { fontFamily: fonts.sansSemiBold, fontSize: 15 },
  meta: { fontFamily: fonts.sans, fontSize: 12.5 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  amount: { fontFamily: fonts.monoSemiBold, fontSize: 13 },
  note: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 16, paddingHorizontal: 2 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 30, paddingHorizontal: 20 },
  emptyTitle: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  emptyBody: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 19, textAlign: 'center', maxWidth: 260 },
});
