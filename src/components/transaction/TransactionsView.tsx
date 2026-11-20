import { isNull } from 'drizzle-orm';
import { router, useNavigation } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabHeaderActions } from '@/components/TabHeaderActions';
import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { DateRangeSheet, MultiPickerSheet, type DateRange } from '@/components/sheets/FilterSheets';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { useCategorySections, useLedgerItems, usePeopleItems } from '@/components/sheets/pickers';
import { TransactionRow } from '@/components/transaction/TransactionRow';
import { Button, Header, IconChip, LinkButton } from '@/components/ui';
import { bulkUpdate, restoreTransactions, softDeleteTransactions, undoBulk, type BulkChange } from '@/data/transaction-ops';
import { listTransactions, type ListKind, type ListRow, type TransactionFilters } from '@/data/transaction-list';
import { db } from '@/db/client';
import { accounts, categories, ledgers, transactions } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { useLive } from '@/state/live';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';

type FilterKey = 'ledger' | 'kind' | 'currency' | 'account' | 'category' | 'dates';
type BulkSheet = 'category' | 'ledger' | 'account' | 'tag' | null;
const BULK_ACTIONS = [
  { key: 'category', icon: 'list' },
  { key: 'ledger', icon: 'layers' },
  { key: 'account', icon: 'card' },
  { key: 'tag', icon: 'user' },
  { key: 'delete', icon: 'trash' },
] as const;

/** The total card when opened from Analytics: the same number as the slice it came from. */
export interface AnalyticsTotal {
  count: number;
  amount: string;
  currency: string;
}

/**
 * Transactions (Spec §9 — Decided): every ledger unless filtered; today and
 * earlier only; transfers as one neutral row; linked items under their original
 * and repeated greyed on their own date. Long-press a row to select several.
 */
export function TransactionsView({ initial, onBack, total }: { initial?: TransactionFilters; onBack?: () => void; total?: AnalyticsTotal | null }) {
  const s = strings.list;
  const { colors } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [filters, setFilters] = useState<TransactionFilters>(() => initial ?? {});
  const [sheet, setSheet] = useState<FilterKey | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [bulkSheet, setBulkSheet] = useState<BulkSheet>(null);

  const groups = useLive((d) => listTransactions(d, filters), [filters]);
  const options = useLive((d) => ({
    ledgers: d.select().from(ledgers).where(isNull(ledgers.archivedAt)).orderBy(ledgers.rank).all(),
    accounts: d.select().from(accounts).orderBy(accounts.rank).all(),
    categories: d.select().from(categories).orderBy(categories.name).all(),
    anyTransactions: !!d.select({ id: transactions.id }).from(transactions).where(isNull(transactions.deletedAt)).limit(1).get(),
  }));
  const currencies = useMemo(() => [...new Set(options.accounts.map((a) => a.currency))], [options.accounts]);
  const expenseCats = useCategorySections('expense');
  const incomeCats = useCategorySections('income');
  const ledgerItems = useLedgerItems();
  const peopleItems = usePeopleItems();

  const selecting = selected !== null;
  // The bulk action bar takes the tab bar's place while selecting.
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ tabBarStyle: selecting ? { display: 'none' } : undefined });
  }, [navigation, selecting]);
  const selectedCurrencies = useMemo(() => {
    const byId = new Map(options.accounts.map((a) => [a.id, a.currency]));
    const rows = db.select({ id: transactions.id, accountId: transactions.accountId }).from(transactions).all();
    return new Set(rows.filter((r) => selected?.includes(r.id) && r.accountId).map((r) => byId.get(r.accountId!)));
  }, [selected, options.accounts]);

  const toggle = (id: string) => setSelected((sel) => (sel ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : [id]));
  // A greyed repeat of a linked row opens its original; it can't be selected itself.
  const open = (r: ListRow) => {
    if (selecting) return r.echoOf ? undefined : toggle(r.id);
    router.push(`/transaction/${r.echoOf ? r.echoOf.id : r.id}`);
  };

  const applyBulk = (change: BulkChange, message: (n: number) => string) => {
    const { changed, undo } = bulkUpdate(db, selected ?? [], change);
    setSelected(null);
    toast(changed ? { message: message(changed), action: { label: s.undo, onPress: () => undoBulk(db, undo) } } : { message: s.nothingChanged });
  };
  const deleteSelected = () => {
    const hidden = softDeleteTransactions(db, selected ?? []);
    setSelected(null);
    toast({ message: s.deleted(selected?.length ?? 0), action: { label: s.undo, onPress: () => restoreTransactions(db, hidden) } });
  };

  const chip = (key: FilterKey, label: string, count: number) => (
    <Pressable
      key={key}
      onPress={() => setSheet(key)}
      style={[styles.chip, { backgroundColor: count ? colors.accentSoft : colors.filled, borderColor: count ? colors.accent : 'transparent' }]}
    >
      <Text style={[styles.chipText, { color: count ? colors.accent : colors.ink }]}>
        {label}
        {count ? ` · ${count}` : ''}
      </Text>
    </Pressable>
  );
  const datesLabel = filters.from || filters.to ? `${filters.from ? formatShortDate(filters.from) : '…'} – ${filters.to ? formatShortDate(filters.to) : '…'}` : s.filters.dates;
  const anyFilter = !!(filters.ledgerIds?.length || filters.kinds?.length || filters.currencies?.length || filters.accountIds?.length || filters.categoryIds?.length || filters.from || filters.to || filters.reimbursable);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.top}>
        {selecting ? (
          <View style={styles.selectBar}>
            <View style={styles.selectSide}>
              <LinkButton label={s.cancel} onPress={() => setSelected(null)} />
            </View>
            <Text style={[styles.selectCount, { color: colors.ink }]}>{s.selected(selected.length)}</Text>
            <View style={styles.selectSide} />
          </View>
        ) : (
          <Header
            title={s.title}
            subtitle={total ? strings.analytics.fromAnalytics : undefined}
            onBack={onBack}
            actions={onBack ? undefined : <TabHeaderActions />}
          />
        )}
        {!selecting ? (
          <View style={styles.chips}>
            {chip('ledger', s.filters.ledger, filters.ledgerIds?.length ?? 0)}
            {chip('kind', s.filters.kind, filters.kinds?.length ?? 0)}
            {chip('currency', s.filters.currency, filters.currencies?.length ?? 0)}
            {chip('account', s.filters.account, filters.accountIds?.length ?? 0)}
            {chip('category', s.filters.category, filters.categoryIds?.length ?? 0)}
            {chip('dates', datesLabel, filters.from || filters.to ? 1 : 0)}
            <Pressable
              onPress={() => setFilters((f) => ({ ...f, reimbursable: !f.reimbursable || undefined }))}
              style={[styles.chip, { backgroundColor: filters.reimbursable ? colors.accentSoft : colors.filled, borderColor: filters.reimbursable ? colors.accent : 'transparent' }]}
            >
              <Text style={[styles.chipText, { color: filters.reimbursable ? colors.accent : colors.ink }]}>{s.filters.reimbursable}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {groups.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.ink }]}>{options.anyTransactions ? s.noMatch : s.emptyTitle}</Text>
          {!options.anyTransactions ? <Text style={[styles.emptyBody, { color: colors.inkSecondary }]}>{s.emptyBody}</Text> : null}
          {anyFilter ? <Button kind="secondary" label={s.clearFilters} onPress={() => setFilters({})} /> : null}
        </View>
      ) : (
        <SectionList
          sections={groups.map((g) => ({ title: g.date, data: g.rows }))}
          keyExtractor={(r) => (r.echoOf ? `echo-${r.id}` : r.id)}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            total ? (
              <View style={{ gap: 8, paddingTop: 6 }}>
                <View style={[styles.totalCard, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.totalText, { color: colors.inkSecondary }]}>{strings.analytics.totalLine(total.count)}</Text>
                  <Money value={total.amount} currency={total.currency} sign="minus" allowCompact={false} style={[styles.totalAmount, { color: colors.expense }]} />
                </View>
                <Text style={[styles.hint, { color: colors.inkMuted, paddingVertical: 0 }]}>{strings.analytics.totalNote}</Text>
              </View>
            ) : (
              <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.linkedHint}</Text>
            )
          }
          renderSectionHeader={({ section }) => (
            <Text style={[styles.day, { color: colors.inkMuted }]}>{formatShortDate(section.title).toUpperCase()}</Text>
          )}
          renderItem={({ item }) => (
            <View>
              <TransactionRow
                row={item}
                selecting={selecting && !item.echoOf}
                selected={!item.echoOf && selected?.includes(item.id)}
                onPress={() => open(item)}
                onLongPress={item.echoOf ? undefined : () => toggle(item.id)}
                last={item.children.length > 0}
              />
              {item.children.map((c, i) => (
                <TransactionRow key={c.id} row={c} child onPress={() => open(item)} last={i < item.children.length - 1} />
              ))}
            </View>
          )}
        />
      )}

      {selecting ? (
        <View style={[styles.actions, { backgroundColor: colors.sheet, borderTopColor: colors.line, paddingBottom: 18 + insets.bottom }]}>
          {BULK_ACTIONS.map(({ key, icon }) => {
            const danger = key === 'delete';
            const tint = !selected.length ? colors.inkMuted : danger ? colors.expense : colors.ink;
            return (
              <Pressable
                key={key}
                onPress={() => (danger ? deleteSelected() : setBulkSheet(key))}
                disabled={!selected.length}
                accessibilityRole="button"
                style={styles.action}
              >
                <View style={[styles.actionIcon, { backgroundColor: danger ? colors.expenseSoft : colors.filled }]}>
                  <Icon name={icon} size={17} color={tint} strokeWidth={1.8} />
                </View>
                <Text style={[styles.actionText, { color: tint }]}>{s.bulk[key]}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Filter sheets */}
      <MultiPickerSheet
        visible={sheet === 'ledger'}
        title={s.filters.ledger}
        items={ledgerItems}
        selected={filters.ledgerIds ?? []}
        onApply={(ids) => setFilters((f) => ({ ...f, ledgerIds: ids.length ? ids : undefined }))}
        onClose={() => setSheet(null)}
      />
      <MultiPickerSheet
        visible={sheet === 'kind'}
        title={s.filters.kind}
        items={(['expense', 'income', 'transfer'] as const).map((k) => ({ id: k, title: s.kinds[k] }))}
        selected={filters.kinds ?? []}
        onApply={(ids) => setFilters((f) => ({ ...f, kinds: ids.length ? (ids as ListKind[]) : undefined }))}
        onClose={() => setSheet(null)}
      />
      <MultiPickerSheet
        visible={sheet === 'currency'}
        title={s.filters.currency}
        items={currencies.map((c) => ({ id: c, title: c }))}
        selected={filters.currencies ?? []}
        onApply={(ids) => setFilters((f) => ({ ...f, currencies: ids.length ? ids : undefined }))}
        onClose={() => setSheet(null)}
      />
      <MultiPickerSheet
        visible={sheet === 'account'}
        title={s.filters.account}
        items={options.accounts.map((a) => ({ id: a.id, title: a.name, detail: a.currency, leading: <IconChip icon={a.icon} color={a.color} size={30} /> }))}
        selected={filters.accountIds ?? []}
        onApply={(ids) => setFilters((f) => ({ ...f, accountIds: ids.length ? ids : undefined }))}
        onClose={() => setSheet(null)}
      />
      <MultiPickerSheet
        visible={sheet === 'category'}
        title={s.filters.category}
        items={[...expenseCats, ...incomeCats]
          .filter((sec) => sec.label !== 'RECENT')
          .flatMap((sec) => sec.items.map((i) => ({ ...i, section: sec.label })))}
        selected={filters.categoryIds ?? []}
        onApply={(ids) => setFilters((f) => ({ ...f, categoryIds: ids.length ? ids : undefined }))}
        onClose={() => setSheet(null)}
      />
      <DateRangeSheet
        visible={sheet === 'dates'}
        value={{ from: filters.from ?? null, to: filters.to ?? null }}
        onApply={(r: DateRange) => setFilters((f) => ({ ...f, from: r.from, to: r.to }))}
        onClose={() => setSheet(null)}
      />

      {/* Bulk action sheets */}
      <PickerSheet
        visible={bulkSheet === 'category'}
        title={s.bulk.category}
        searchPlaceholder="Search categories"
        sections={[...expenseCats, ...incomeCats].filter((sec) => sec.label !== 'RECENT')}
        onSelect={(id) => applyBulk({ field: 'category', categoryId: id }, (n) => s.changedCategory(n, options.categories.find((c) => c.id === id)?.name ?? ''))}
        onClose={() => setBulkSheet(null)}
      />
      <PickerSheet
        visible={bulkSheet === 'ledger'}
        title={s.bulk.ledger}
        sections={[{ items: ledgerItems }]}
        onSelect={(id) => applyBulk({ field: 'ledger', ledgerId: id }, (n) => s.movedLedger(n, options.ledgers.find((l) => l.id === id)?.name ?? ''))}
        onClose={() => setBulkSheet(null)}
      />
      <PickerSheet
        visible={bulkSheet === 'account'}
        title={s.bulk.account}
        sections={[
          {
            items:
              selectedCurrencies.size === 1
                ? options.accounts
                    .filter((a) => !a.archivedAt && selectedCurrencies.has(a.currency))
                    .map((a) => ({ id: a.id, title: a.name, detail: a.currency, leading: <IconChip icon={a.icon} color={a.color} size={30} /> }))
                : [{ id: '_none', title: s.sameCurrencyOnly, disabled: true }],
          },
        ]}
        onSelect={(id) => applyBulk({ field: 'account', accountId: id }, (n) => s.changedAccount(n, options.accounts.find((a) => a.id === id)?.name ?? ''))}
        onClose={() => setBulkSheet(null)}
      />
      <PickerSheet
        visible={bulkSheet === 'tag'}
        title={strings.add.tag}
        searchPlaceholder="Search people"
        sections={[{ items: peopleItems }]}
        clearLabel={strings.common.none}
        onSelect={(id) => applyBulk({ field: 'tag', personId: id || null }, (n) => s.tagged(n, peopleItems.find((p) => p.id === id)?.title ?? strings.common.none))}
        onClose={() => setBulkSheet(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6, gap: 14 },
  selectBar: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  selectSide: { flex: 1, alignItems: 'flex-start' },
  selectCount: { fontFamily: fonts.serif, fontSize: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 7, borderWidth: 1 },
  chipText: { fontFamily: fonts.sansBold, fontSize: 12.5 },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  totalCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.card, paddingHorizontal: 15, paddingVertical: 12 },
  totalText: { fontFamily: fonts.sans, fontSize: 12 },
  totalAmount: { fontFamily: fonts.monoSemiBold, fontSize: 17 },
  hint: { fontFamily: fonts.sans, fontSize: 10.5, lineHeight: 15, paddingBottom: 8 },
  day: { fontFamily: fonts.sansExtraBold, fontSize: 12, letterSpacing: 0.72, paddingTop: 14, paddingBottom: 2, paddingHorizontal: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  emptyTitle: { fontFamily: fonts.serif, fontSize: 20 },
  emptyBody: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  actions: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 12, paddingHorizontal: 16, gap: 4 },
  action: { flex: 1, alignItems: 'center', gap: 4 },
  actionIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontFamily: fonts.sansBold, fontSize: 10 },
});
