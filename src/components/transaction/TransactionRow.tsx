import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { IconChip } from '@/components/ui';
import type { ListRow, ListTag } from '@/data/transaction-list';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { fonts, radius, useTheme } from '@/theme';

/** The words for a row's title, falling back by kind. */
export function rowTitle(r: ListRow): string {
  if (r.title) return r.title;
  if (r.kind === 'opening_balance') return strings.list.openingBalance;
  if (r.kind === 'balance_adjustment') return strings.list.balanceAdjustment;
  if (r.linkType) return r.linkType === 'refund' ? strings.list.refund : strings.list.reimbursement;
  return strings.add.noCategory;
}

/** Home's Recent line: "Sep 29 · Payoneer USD · auto-added". */
export function recentDetail(r: ListRow, hideAccount = false): string {
  const parts = [formatShortDate(r.date)];
  if (r.paidByName) parts.push(strings.home.yourShare);
  else if (r.kind === 'income' && r.title && r.categoryName && r.title !== r.categoryName) parts.push(r.categoryName);
  else if (r.kind === 'transfer' && r.title === r.accountName) parts.push(strings.list.transfer);
  else if (r.accountName && !hideAccount) parts.push(r.accountName);
  if (r.tags.includes('auto_review') || r.tags.includes('auto')) parts.push(strings.home.autoAdded);
  if (r.tags.includes('reimbursable')) parts.push(strings.home.reimbursableShort);
  return parts.join(' · ');
}

/** Expenses read "−", income and balance adjustments "+"; transfers and opening balances show only a real minus. */
export function amountSign(row: Pick<ListRow, 'kind' | 'amount'>): 'minus' | 'always' | 'auto' {
  if (row.amount.tone === 'expense') return 'minus';
  return row.amount.tone === 'income' || row.kind === 'balance_adjustment' ? 'always' : 'auto';
}

function tagLabel(tag: ListTag, r: ListRow): string {
  return tag === 'paid_by' ? strings.list.paidByTag(r.paidByName ?? '') : strings.list.tags[tag];
}

/**
 * One transaction in a list. Transfers are neutral with what arrived (and what
 * was sent under it); linked refunds sit under their original with ↳; a linked
 * row repeated on its own date is greyed and opens the original.
 */
export function TransactionRow({
  row,
  variant = 'list',
  child,
  selected,
  selecting,
  onPress,
  onLongPress,
  last,
}: {
  row: ListRow;
  /** 'recent': date-first detail (Home); 'account': the same on an account's own page, without its name. */
  variant?: 'list' | 'recent' | 'account';
  child?: boolean;
  selected?: boolean;
  selecting?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  last?: boolean;
}) {
  const { colors } = useTheme();
  const echo = !!row.echoOf;
  const sign = amountSign(row);
  const moneyValue = row.amount.value;
  const amountColor = row.amount.tone === 'expense' ? colors.expense : row.amount.tone === 'income' ? colors.income : colors.ink;
  const dim = echo || row.cancelled;

  let title = rowTitle(row);
  let detail: string;
  if (echo) {
    title = `↳ ${strings.list.echoTitle(row.linkType === 'refund' ? strings.list.refund : strings.list.reimbursement, row.echoOf!.title ?? '')}`;
    detail = [strings.list.echoFor(formatShortDate(row.echoOf!.date)), row.accountName, strings.list.echoTap].filter(Boolean).join(' · ');
  } else if (child) {
    title = `↳ ${title}`;
    detail = [formatShortDate(row.date), row.accountName].filter(Boolean).join(' · ');
  } else if (variant !== 'list') {
    detail = recentDetail(row, variant === 'account' && row.kind !== 'transfer');
  } else if (row.paidByName) {
    detail = [strings.list.paidBy(row.paidByName), strings.home.yourShare, row.amount.currency].join(' · ');
  } else if (row.kind === 'transfer') {
    detail = row.title === row.accountName ? `${strings.list.transfer} · ${row.amount.currency}` : (row.accountName ?? '');
  } else {
    detail = row.accountName ?? '';
  }

  const tags = variant === 'list' && !child && !echo ? row.tags : [];

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        child && styles.child,
        !last && { borderBottomWidth: 1, borderBottomColor: colors.line },
        pressed && { backgroundColor: colors.filled },
        selected && { backgroundColor: colors.accentSoft },
      ]}
    >
      {selecting ? (
        <View style={[styles.check, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accent : 'transparent' }]}>
          {selected ? <Icon name="tick" size={12} color={colors.onAccent} strokeWidth={3} /> : null}
        </View>
      ) : null}
      {!child && !echo ? <IconChip icon={row.icon.name} color={row.icon.color} size={36} /> : null}
      <View style={{ flex: 1, opacity: dim ? 0.55 : 1 }}>
        <Text style={[styles.title, { color: colors.ink }, row.cancelled && styles.struck, (child || echo) && styles.childTitle]} numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text style={[styles.detail, { color: colors.inkMuted }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
        {tags.length ? (
          <View style={styles.tags}>
            {tags.map((t) => (
              <View key={t} style={[styles.tag, { backgroundColor: t === 'reimbursed' ? colors.accentSoft : colors.filled }]}>
                <Text style={[styles.tagText, { color: t === 'reimbursed' ? colors.accent : colors.inkSecondary }]}>{tagLabel(t, row)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', opacity: dim ? 0.55 : 1 }}>
        <Money value={moneyValue} currency={row.amount.currency} sign={sign} style={[styles.amount, { color: amountColor }, row.cancelled && styles.struck]} />
        {row.sent ? (
          <Text style={[styles.sent, { color: colors.inkMuted }]}>
            <Money value={row.sent.value} currency={row.sent.currency} sign="never" style={[styles.sent, { color: colors.inkMuted }]} /> {strings.list.sent}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 60 },
  child: { paddingStart: 62, paddingVertical: 9, minHeight: 0 },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  childTitle: { fontFamily: fonts.sansMedium, fontSize: 13 },
  detail: { fontFamily: fonts.sans, fontSize: 12, marginTop: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  tag: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontFamily: fonts.sansBold, fontSize: 9.5, letterSpacing: 0.3 },
  amount: { fontSize: 14 },
  sent: { fontFamily: fonts.mono, fontSize: 11 },
  struck: { textDecorationLine: 'line-through' },
  check: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
