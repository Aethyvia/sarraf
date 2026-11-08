import { goBack } from '@/state/nav';
import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { RecurringRow } from '@/components/RecurringRow';
import { Card, Header, IconButton, Screen, SectionLabel } from '@/components/ui';
import { recurringItems } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { useLive } from '@/state/live';
import { fonts, useTheme } from '@/theme';

/** Recurring (from Home's "See all" and Settings): every item, same amount and amount varies. */
export default function RecurringListScreen() {
  const s = strings.recurring;
  const { colors } = useTheme();
  const items = useLive((d) => d.select().from(recurringItems).orderBy(recurringItems.nextDueDate).all());
  const same = items.filter((i) => i.amountType === 'same');
  const varies = items.filter((i) => i.amountType === 'varies');
  return (
    <Screen>
      <Header title={s.title} onBack={goBack} actions={<IconButton icon="plus" filled label={s.add} onPress={() => router.push('/recurring/new')} />} />
      {items.length === 0 ? <Text style={[styles.empty, { color: colors.inkSecondary }]}>{s.empty}</Text> : null}
      {same.length ? (
        <>
          <SectionLabel>{s.sameSection}</SectionLabel>
          <Card>
            {same.map((i, n) => (
              <RecurringRow key={i.id} item={i} variant="list" last={n === same.length - 1} />
            ))}
          </Card>
        </>
      ) : null}
      {varies.length ? (
        <>
          <SectionLabel>{s.variesSection}</SectionLabel>
          <Card>
            {varies.map((i, n) => (
              <RecurringRow key={i.id} item={i} variant="list" last={n === varies.length - 1} />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19 },
});
