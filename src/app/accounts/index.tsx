import { goBack } from '@/state/nav';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { BottomSheet, Card, Header, IconButton, IconChip, LinkButton, ListRow, Screen, SheetOption } from '@/components/ui';
import { accountBalances } from '@/data/balances';
import { accounts } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { compare } from '@/lib/money';
import { useLive } from '@/state/live';
import { fonts, useTheme } from '@/theme';

type Sort = 'custom' | 'nameAsc' | 'nameDesc' | 'balanceDesc' | 'balanceAsc';

/** Accounts, grouped by institution. No per-currency totals: those live on Home only. */
export default function AccountsScreen() {
  const s = strings.accounts;
  const { colors } = useTheme();
  // Opened from a Home tile: just that currency's accounts.
  const { currency } = useLocalSearchParams<{ currency?: string }>();
  const [sort, setSort] = useState<Sort>('custom');
  const [sorting, setSorting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const data = useLive((db) => ({
    rows: db.select().from(accounts).orderBy(accounts.rank).all(),
    balances: accountBalances(db),
  }));

  const groups = useMemo(() => {
    const balance = (id: string) => data.balances.get(id) ?? '0';
    const sorted = data.rows.filter((a) => !currency || a.currency === currency).sort((a, b) => {
      switch (sort) {
        case 'nameAsc':
          return a.name.localeCompare(b.name);
        case 'nameDesc':
          return b.name.localeCompare(a.name);
        // Balances in different currencies aren't comparable; sort by currency, then amount.
        case 'balanceDesc':
          return a.currency.localeCompare(b.currency) || compare(balance(b.id), balance(a.id));
        case 'balanceAsc':
          return a.currency.localeCompare(b.currency) || compare(balance(a.id), balance(b.id));
        default:
          return a.rank - b.rank;
      }
    });
    const active = sorted.filter((a) => !a.archivedAt);
    const byInstitution = new Map<string, typeof active>();
    for (const a of active.filter((x) => x.institution)) {
      byInstitution.set(a.institution!, [...(byInstitution.get(a.institution!) ?? []), a]);
    }
    return {
      institutions: [...byInstitution],
      plain: active.filter((a) => !a.institution),
      archived: sorted.filter((a) => a.archivedAt),
    };
  }, [data, sort, currency]);

  const row = (a: (typeof data.rows)[number], last: boolean, muted = false) => (
    <ListRow
      key={a.id}
      title={a.name}
      detail={a.currency}
      muted={muted}
      leading={<IconChip icon={a.icon} color={a.color} />}
      trailing={<Money value={data.balances.get(a.id) ?? '0'} currency={a.currency} style={[styles.balance, muted && { color: colors.inkMuted }]} />}
      onPress={() => router.push(`/accounts/${a.id}`)}
      last={last}
    />
  );

  const sortLabels: Record<Sort, string> = {
    nameAsc: strings.sort.nameAsc,
    nameDesc: strings.sort.nameDesc,
    balanceDesc: strings.sort.balanceDesc,
    balanceAsc: strings.sort.balanceAsc,
    custom: strings.sort.custom,
  };

  return (
    <Screen>
      <Header
        title={currency ? `${s.title} · ${currency}` : s.title}
        subtitle={s.sortedBy(sortLabels[sort])}
        onBack={goBack}
        actions={
          <>
            <IconButton icon="sort" label={strings.sort.title(s.title.toLowerCase())} onPress={() => setSorting(true)} />
            <IconButton icon="plus" filled label={s.add} onPress={() => router.push('/accounts/new')} />
          </>
        }
      />

      {groups.institutions.map(([institution, list]) => (
        <Card key={institution}>
          <Text style={[styles.institution, { color: colors.inkMuted }]}>{institution.toUpperCase()}</Text>
          {list.map((a, i) => row(a, i === list.length - 1))}
        </Card>
      ))}
      {groups.plain.length > 0 ? <Card>{groups.plain.map((a, i) => row(a, i === groups.plain.length - 1))}</Card> : null}

      {groups.archived.length > 0 ? (
        showArchived ? (
          <>
            <Text style={[styles.institution, { color: colors.inkMuted, paddingHorizontal: 4 }]}>{strings.common.archived.toUpperCase()}</Text>
            <Card>{groups.archived.map((a, i) => row(a, i === groups.archived.length - 1, true))}</Card>
            <LinkButton label={s.hideArchived} onPress={() => setShowArchived(false)} />
          </>
        ) : (
          <LinkButton label={`${s.showArchived} (${groups.archived.length})`} onPress={() => setShowArchived(true)} />
        )
      ) : null}

      <BottomSheet visible={sorting} onClose={() => setSorting(false)} title={strings.sort.title(s.title.toLowerCase())}>
        {(Object.keys(sortLabels) as Sort[]).map((key) => (
          <SheetOption
            key={key}
            title={sortLabels[key]}
            detail={key === 'custom' ? strings.sort.customDetail : undefined}
            selected={sort === key}
            onPress={() => {
              setSort(key);
              setSorting(false);
              if (key === 'custom') router.push('/accounts/reorder');
            }}
          />
        ))}
      </BottomSheet>
      <View style={{ height: 8 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  institution: { fontFamily: fonts.sansExtraBold, fontSize: 10.5, letterSpacing: 0.63, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 2 },
  balance: { fontSize: 15 },
});
