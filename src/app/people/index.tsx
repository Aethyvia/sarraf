import { goBack } from '@/state/nav';
import { max, or, eq } from 'drizzle-orm';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, Header, IconButton, ListRow, Screen } from '@/components/ui';
import { people, personEntries, transactions } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { useLive } from '@/state/live';
import { fonts, radius, useTheme } from '@/theme';

const AVATAR_COLORS = ['neutral', 'purple', 'pink', 'teal', 'blue', 'orange', 'cyan', 'gold'];

/** The latest date anything happened with this person: a transfer, an expense they paid, a tag, a split or a settlement. */
function lastActivity(db: AppDb, personId: string): string | null {
  const tx = db
    .select({ d: max(transactions.date) })
    .from(transactions)
    .where(or(eq(transactions.transferPersonId, personId), eq(transactions.paidByPersonId, personId), eq(transactions.referencePersonId, personId)))
    .get()?.d;
  const entry = db.select({ d: max(personEntries.date) }).from(personEntries).where(eq(personEntries.personId, personId)).get()?.d;
  return [tx, entry].filter((d): d is string => !!d).sort().pop() ?? null;
}

/** People: names and last activity only. No balances or totals on the list. */
export default function PeopleScreen() {
  const s = strings.people;
  const { colors } = useTheme();
  const rows = useLive((db) =>
    db
      .select()
      .from(people)
      .orderBy(people.name)
      .all()
      .map((p) => ({ ...p, last: lastActivity(db, p.id) })),
  );

  return (
    <Screen>
      <Header
        title={s.title}
        onBack={goBack}
        actions={<IconButton icon="plus" filled label={s.add} onPress={() => router.push('/people/new')} />}
      />
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.ink }]}>{s.emptyTitle}</Text>
          <Text style={[styles.emptyBody, { color: colors.inkSecondary }]}>{s.emptyBody}</Text>
        </View>
      ) : (
        <Card>
          {rows.map((p, i) => (
            <ListRow
              key={p.id}
              title={p.name}
              muted={!!p.archivedAt}
              detail={p.archivedAt ? strings.common.archived : p.last ? `Last activity ${formatShortDate(p.last)}` : p.note ?? undefined}
              leading={<Avatar name={p.name} index={i} />}
              onPress={() => router.push(`/people/${p.id}`)}
              last={i === rows.length - 1}
            />
          ))}
        </Card>
      )}
      <Button kind="dashed" label={s.addDashed} onPress={() => router.push('/people/new')} />
    </Screen>
  );
}

function Avatar({ name, index }: { name: string; index: number }) {
  const { swatch } = useTheme();
  const look = swatch(AVATAR_COLORS[index % AVATAR_COLORS.length]);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <View style={[styles.avatar, { backgroundColor: look.bg }]}>
      <Text style={[styles.initials, { color: look.fg }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { paddingVertical: 32, gap: 8, alignItems: 'center' },
  emptyTitle: { fontFamily: fonts.serif, fontSize: 20 },
  emptyBody: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19, textAlign: 'center', paddingHorizontal: 12 },
  avatar: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: fonts.sansBold, fontSize: 13 },
});
