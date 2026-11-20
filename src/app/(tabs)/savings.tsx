import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TabHeaderActions } from '@/components/TabHeaderActions';
import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { Plant } from '@/components/Plant';
import { Button, Card, LinkButton } from '@/components/ui';
import { goalTotal } from '@/data/goals';
import { plantFor } from '@/data/plant';
import { savingsGoals } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { useLive } from '@/state/live';
import { fonts, useTheme } from '@/theme';

/** Savings (tab): each goal as a plant that grows with what it holds of its target (style F, owner Nov 20), by priority; completed goals below as a small harvest. */
export default function SavingsScreen() {
  const s = strings.savingsTab;
  const g = strings.goals;
  const p = strings.plant;
  const { colors } = useTheme();
  // Archived goals stay out of the way until asked for, like archived accounts (owner, Nov 20).
  const [showArchived, setShowArchived] = useState(false);
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
          <TabHeaderActions />
        </View>
        {open.length + done.length === 0 && archived.length === 0 ? (
          <Card style={styles.empty}>
            <Icon name="piggy" size={30} color={colors.border} strokeWidth={1.6} />
            <Text style={[styles.emptyTitle, { color: colors.inkSecondary }]}>{g.emptyTitle}</Text>
            <Text style={[styles.emptyBody, { color: colors.inkMuted }]}>{g.emptyBody}</Text>
          </Card>
        ) : null}
        {[...open, ...done, ...(showArchived ? archived : [])].map((x) => {
          // Savings F (owner, Nov 20): each goal is a plant that grows with what it holds of its target.
          const view = plantFor(x.held, x.targetAmount, x.currency, !!x.completedAt);
          const stageName = p.stages[view.stage];
          const small = (v: string) => <Money value={v} currency={x.currency} style={[styles.hint, styles.mono, { color: colors.inkSecondary }]} />;
          return (
            <Pressable key={x.id} onPress={() => router.push(`/goals/${x.id}`)} accessibilityRole="button">
              <Card style={[styles.card, x.completedAt || x.archivedAt ? { opacity: 0.6 } : null]}>
                <Plant stage={view.stage} width={x.completedAt ? 72 : 104} height={x.completedAt ? 84 : 128} />
                <View style={styles.cardText}>
                  <Text style={[styles.badge, { color: view.stage === 'seed' || view.stage === 'harvest' ? colors.inkMuted : colors.accent }]}>
                    {view.stage === 'harvest' ? p.harvested : p.badge(stageName, view.pct)}
                  </Text>
                  <Text style={[styles.name, { color: colors.ink }]} numberOfLines={2}>{x.name}</Text>
                  <Text style={[styles.meta, { color: colors.inkMuted }]}>
                    {x.completedAt ? (
                      `${x.currency} · ${g.completed}`
                    ) : (
                      <>
                        <Money value={x.held} currency={x.currency} style={[styles.amount, { color: colors.ink }]} /> {s.of}{' '}
                        <Money value={x.targetAmount} currency={x.currency} style={[styles.amount, { color: colors.inkMuted }]} />
                      </>
                    )}
                  </Text>
                  {x.archivedAt ? (
                    <Text style={[styles.hint, { color: colors.inkMuted }]}>{`${x.currency} · ${g.archived}`}</Text>
                  ) : x.completedAt ? null : view.stage === 'seed' ? (
                    <Text style={[styles.hint, { color: colors.inkSecondary }]}>{p.seedHint}</Text>
                  ) : view.next ? (
                    <Text style={[styles.hint, { color: colors.inkSecondary }]}>
                      {parts(view.next.stage === 'fruit' ? p.fruitNext(small(view.next.toGo)) : p.next(p.stages[view.next.stage], view.next.pct, small(view.next.toGo)))}
                    </Text>
                  ) : (
                    <Text style={[styles.hint, { color: colors.accent }]}>{p.reached}</Text>
                  )}
                  {!x.completedAt && !x.archivedAt ? <Text style={[styles.hint, { color: colors.inkMuted }]}>{`${x.currency} · ${s.priority(x.priority)}`}</Text> : null}
                </View>
                <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} />
              </Card>
            </Pressable>
          );
        })}
        {archived.length ? (
          <LinkButton label={showArchived ? g.hideArchived : g.showArchived(archived.length)} onPress={() => setShowArchived((v) => !v)} />
        ) : null}
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
  card: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardText: { flex: 1, minWidth: 0, gap: 4 },
  badge: { fontFamily: fonts.sansExtraBold, fontSize: 11, letterSpacing: 1.1 },
  name: { fontFamily: fonts.sansBold, fontSize: 17 },
  hint: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16 },
  mono: { fontFamily: fonts.mono },
  meta: { fontFamily: fonts.sans, fontSize: 12.5 },
  amount: { fontFamily: fonts.monoSemiBold, fontSize: 13 },
  note: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 16, paddingHorizontal: 2 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 30, paddingHorizontal: 20 },
  emptyTitle: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  emptyBody: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 19, textAlign: 'center', maxWidth: 260 },
});
