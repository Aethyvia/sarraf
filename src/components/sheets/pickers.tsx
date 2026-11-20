import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { Badge, IconChip, Segmented } from '@/components/ui';
import { accountBalances } from '@/data/balances';
import { goalTotal } from '@/data/goals';
import { accountFree } from '@/data/usable';
import { accounts, categories, ledgers, people, savingsGoals, transactions } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { personPhotoUri } from '@/services/person-photo';
import { useLive } from '@/state/live';
import { fonts, radius, useTheme } from '@/theme';
import { PickerSheet, type PickerItem, type PickerSection } from './PickerSheet';

/** Category sheet (Decided Nov 7): the last 3 used first, then A–Z with subcategories under their parent. */
export function useCategorySections(kind: 'expense' | 'income'): PickerSection[] {
  return useLive(
    (db) => {
      const all = db.select().from(categories).where(and(eq(categories.kind, kind), isNull(categories.archivedAt))).orderBy(categories.name).all();
      const byId = new Map(all.map((c) => [c.id, c]));
      const subCount = (id: string) => all.filter((x) => x.parentId === id).length;
      const item = (c: (typeof all)[number], indent = false): PickerItem => {
        const parent = c.parentId ? byId.get(c.parentId) : undefined;
        const n = subCount(c.id);
        return {
          id: c.id,
          title: c.name,
          indent,
          // Subcategories carry their parent's look, smaller, so they read as part of it.
          leading: <IconChip icon={c.icon} color={parent?.color ?? c.color} size={indent ? 24 : 30} />,
          detail: indent ? undefined : n > 0 ? strings.categories.subCount(n) : undefined,
          searchDetail: parent ? strings.categories.inParent(parent.name) : undefined,
          trailing: c.isSystem ? <Badge label={strings.common.builtIn} tone="neutral" /> : undefined,
        };
      };
      const recentIds: string[] = [];
      for (const r of db
        .select({ id: transactions.categoryId })
        .from(transactions)
        .where(and(isNotNull(transactions.categoryId), eq(transactions.kind, kind)))
        .orderBy(desc(transactions.createdAt))
        .limit(60)
        .all()) {
        if (r.id && byId.has(r.id) && !recentIds.includes(r.id)) recentIds.push(r.id);
        if (recentIds.length === 3) break;
      }
      const tree: PickerItem[] = [];
      for (const c of all.filter((x) => !x.parentId)) {
        tree.push(item(c));
        for (const sub of all.filter((x) => x.parentId === c.id)) tree.push(item(sub, true));
      }
      return [
        ...(recentIds.length ? [{ label: 'RECENT', items: recentIds.map((id) => item(byId.get(id)!)) }] : []),
        { label: `${kind === 'expense' ? 'EXPENSE' : 'INCOME'} · A–Z`, items: tree },
      ];
    },
    [kind],
  );
}

export function usePeopleItems(): PickerItem[] {
  return useLive((db) =>
    db
      .select()
      .from(people)
      .where(isNull(people.archivedAt))
      .orderBy(people.name)
      .all()
      .map((p) => ({ id: p.id, title: p.name, detail: p.note ?? undefined, leading: <Initials name={p.name} photo={p.photoPath} /> })),
  );
}

export function useLedgerItems(): PickerItem[] {
  return useLive((db) =>
    db
      .select()
      .from(ledgers)
      .where(isNull(ledgers.archivedAt))
      .orderBy(ledgers.rank)
      .all()
      .map((l) => ({
        id: l.id,
        title: l.name,
        leading: <IconChip icon={l.icon} color={l.color} size={30} />,
        trailing: l.isDefault ? <Badge label={strings.common.default} /> : undefined,
      })),
  );
}

/** Active goals with what they hold, for Add — Savings. */
export function useGoalItems(): (PickerItem & { currency: string; target: string; held: string })[] {
  return useLive((db) =>
    db
      .select()
      .from(savingsGoals)
      .where(and(isNull(savingsGoals.archivedAt), isNull(savingsGoals.completedAt)))
      .orderBy(savingsGoals.priority)
      .all()
      .map((g) => ({ id: g.id, title: g.name, detail: `${g.currency} · priority ${g.priority}`, currency: g.currency, target: g.targetAmount, held: goalTotal(db, g.id) })),
  );
}

type AccountRow = typeof accounts.$inferSelect;

/** Active accounts grouped by institution, each with its balance (or what's free in it). */
export function useAccountSections(options: { currency?: string | null; excludeId?: string | null; showFree?: boolean } = {}): PickerSection[] {
  const { currency = null, excludeId = null, showFree = false } = options;
  return useLive(
    (db) => {
      const rows = db.select().from(accounts).where(isNull(accounts.archivedAt)).orderBy(accounts.rank).all();
      const balances = accountBalances(db);
      const pick = rows.filter((a) => (!currency || a.currency === currency) && a.id !== excludeId);
      const item = (a: AccountRow): PickerItem => ({
        id: a.id,
        title: a.name,
        detail: a.currency,
        leading: <IconChip icon={a.icon} color={a.color} size={32} />,
        trailing: <Money value={showFree ? accountFree(db, a.id).free : (balances.get(a.id) ?? '0')} currency={a.currency} style={styles.balance} />,
      });
      const groups = new Map<string, AccountRow[]>();
      for (const a of pick.filter((x) => x.institution)) groups.set(a.institution!, [...(groups.get(a.institution!) ?? []), a]);
      const loose = pick.filter((a) => !a.institution);
      return [
        ...[...groups].map(([label, list]) => ({ label: label.toUpperCase(), groupIcon: 'bank', items: list.map(item) })),
        // With institution groups above, the rest get a label so the split is clear.
        { label: groups.size && loose.length ? strings.accounts.otherAccounts : undefined, items: loose.map(item) },
      ];
    },
    [currency, excludeId, showFree],
  );
}

export type Side = { type: 'account' | 'person'; id: string } | null;

/**
 * "Paid from" / From / To: an account or, on the Person tab, a person (a loan,
 * or a payment made on your behalf).
 */
export function AccountOrPersonSheet({
  visible,
  title,
  value,
  allowPerson,
  excludeAccountId,
  onSelect,
  onClose,
  onNewAccount,
  onNewPerson,
}: {
  visible: boolean;
  title: string;
  value: Side;
  allowPerson: boolean;
  excludeAccountId?: string | null;
  onSelect: (side: Side) => void;
  onClose: () => void;
  onNewAccount?: () => void;
  onNewPerson?: () => void;
}) {
  const { colors } = useTheme();
  const [tab, setTab] = useState<'account' | 'person'>(value?.type ?? 'account');
  const accountSections = useAccountSections({ excludeId: excludeAccountId });
  const personItems = usePeopleItems();
  const s = strings.add;
  return (
    <PickerSheet
      visible={visible}
      title={title}
      header={
        allowPerson ? (
          <View style={{ gap: 8, marginBottom: 8 }}>
            <Segmented
              options={[
                { value: 'account', label: s.accountTab },
                { value: 'person', label: s.personTab },
              ]}
              value={tab}
              onChange={setTab}
            />
            {tab === 'person' ? <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.personTabHint}</Text> : null}
          </View>
        ) : null
      }
      searchPlaceholder={tab === 'account' ? 'Search accounts' : 'Search people'}
      sections={tab === 'account' ? accountSections : [{ items: personItems }]}
      selectedId={value?.type === tab ? value.id : null}
      onSelect={(id) => onSelect({ type: tab, id })}
      onClose={onClose}
      newLabel={tab === 'account' ? `+ ${strings.accounts.add}` : `+ ${strings.people.add}`}
      onNew={tab === 'account' ? onNewAccount : onNewPerson}
    />
  );
}

/** A person's circle: their profile picture when they have one (owner, Nov 20), otherwise their initials. */
export function Initials({ name, size = 30, photo, look }: { name: string; size?: number; photo?: string | null; look?: { bg: string; fg: string } }) {
  const { colors } = useTheme();
  const uri = personPhotoUri(photo);
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} accessibilityIgnoresInvertColors />;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: look?.bg ?? colors.filled, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: fonts.sansBold, fontSize: size * 0.4, color: look?.fg ?? colors.inkSecondary }}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  balance: { fontSize: 13 },
  hint: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 4 },
});
