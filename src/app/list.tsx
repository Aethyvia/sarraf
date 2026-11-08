import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { TransactionsView } from '@/components/transaction/TransactionsView';
import { flows } from '@/data/spending';
import type { ListKind, TransactionFilters } from '@/data/transaction-list';
import { db } from '@/db/client';
import { goBack } from '@/state/nav';

/**
 * Transactions opened with filters already set — from Analytics (ledger, range,
 * currency, Expense and a category with its subcategories, plus a total that
 * equals the slice), Account detail, or a person's Expected back.
 */
export default function FilteredTransactionsScreen() {
  const p = useLocalSearchParams<{
    account?: string;
    reimbursable?: string;
    ledger?: string;
    from?: string;
    to?: string;
    currency?: string;
    kind?: ListKind;
    category?: string;
    fromAnalytics?: string;
  }>();
  const initial: TransactionFilters = {
    accountIds: p.account ? [p.account] : undefined,
    reimbursable: p.reimbursable === '1' || undefined,
    ledgerIds: p.ledger ? [p.ledger] : undefined,
    from: p.from,
    to: p.to,
    currencies: p.currency ? [p.currency] : undefined,
    kinds: p.kind ? [p.kind] : undefined,
    categoryIds: p.category ? [p.category] : undefined,
  };
  // The same calculation as the chart, so the total always equals the slice.
  const total = useMemo(() => {
    if (p.fromAnalytics !== '1' || !p.currency || !p.from || !p.to || !p.category) return null;
    const hit = flows(db, { currency: p.currency, from: p.from, to: p.to, ledgerId: p.ledger || null }).spending.find((x) => x.categoryId === p.category);
    return hit ? { count: hit.count, amount: hit.amount, currency: p.currency } : null;
  }, [p.fromAnalytics, p.currency, p.from, p.to, p.category, p.ledger]);
  return <TransactionsView initial={initial} onBack={goBack} total={total} />;
}
