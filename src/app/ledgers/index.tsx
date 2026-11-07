import { count, eq } from 'drizzle-orm';
import { router } from 'expo-router';
import { View } from 'react-native';

import { Badge, Button, Card, Header, IconButton, IconChip, ListRow, Screen } from '@/components/ui';
import { budgets, ledgers } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { useLive } from '@/state/live';

/** Ledgers: separate books, e.g. Personal and Business. */
export default function LedgersScreen() {
  const s = strings.ledgers;
  const rows = useLive((db) =>
    db
      .select({ ledger: ledgers, budgetCount: count(budgets.id) })
      .from(ledgers)
      .leftJoin(budgets, eq(budgets.ledgerId, ledgers.id))
      .groupBy(ledgers.id)
      .orderBy(ledgers.rank)
      .all(),
  );
  return (
    <Screen>
      <Header
        title={s.title}
        subtitle={s.subtitle}
        onBack={() => router.back()}
        actions={<IconButton icon="plus" filled label={s.add} onPress={() => router.push('/ledgers/new')} />}
      />
      {rows.map(({ ledger, budgetCount }) => (
        <Card key={ledger.id}>
          <ListRow
            last
            muted={!!ledger.archivedAt}
            title={ledger.name}
            detail={ledger.archivedAt ? strings.common.archived : `${budgetCount} ${budgetCount === 1 ? 'budget' : 'budgets'}`}
            leading={<IconChip icon={ledger.icon} color={ledger.color} size={34} />}
            trailing={ledger.isDefault ? <Badge label={strings.common.default} /> : undefined}
            onPress={() => router.push(`/ledgers/${ledger.id}`)}
          />
        </Card>
      ))}
      <View>
        <Button kind="dashed" label={`+ ${s.add}`} onPress={() => router.push('/ledgers/new')} />
      </View>
    </Screen>
  );
}
