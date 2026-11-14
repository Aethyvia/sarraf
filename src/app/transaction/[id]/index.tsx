import { goBack } from '@/state/nav';
import { eq } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { MoneyInline, chargeLabel, formatLongDate, receiptLines } from '@/components/transaction/parts';
import { buildReceipt as buildReceiptRows } from '@/data/receipt';
import { GotItSheet } from '@/components/transaction/GotItSheet';
import { SharesKeptNote } from '@/components/transaction/SharesKeptNote';
import { amountSign, rowTitle } from '@/components/transaction/TransactionRow';
import { BottomSheet, Button, Card, Header, IconChip, LinkButton, Screen } from '@/components/ui';
import { vsMarketPercent } from '@/data/amounts';
import { attachmentsOf } from '@/data/attachments';
import { chargedCurrencyOf , chargesOf } from '@/data/owing';
import { splitOf } from '@/data/splits';
import { cancelTransaction } from '@/data/review';
import { deleteTransaction, deletionSet, restoreCancelled } from '@/data/transaction-ops';
import { toListRowFromDb } from '@/data/transaction-list';
import { db } from '@/db/client';
import { accounts, categories, ledgers, people, transactionCharges, transactions } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { dec, toDecimalString } from '@/lib/money';
import { parts } from '@/components/parts';
import { deleteStoredFiles, formatBytes } from '@/services/attachments';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Transaction detail (Spec §9a — Decided): the amount, the charges as the same
 * receipt as Add (with the rate for other-currency entries), linked entries,
 * the fields that have something in them, attachments, and Edit / Duplicate /
 * Delete. Linked entries are added from their own screens, not here.
 */
export default function TransactionDetailScreen() {
  const s = strings.detail;
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const toast = useToast();
  const action = useAction();
  const [deleting, setDeleting] = useState(false);
  const [gotIt, setGotIt] = useState(false);

  const data = useLive(
    (d) => {
      const t = d.select().from(transactions).where(eq(transactions.id, id)).get();
      if (!t || t.deletedAt) return null;
      const name = <T extends { id: string; name: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r.name]));
      const accountRows = d.select().from(accounts).all();
      return {
        t,
        row: toListRowFromDb(d, t),
        charges: d.select().from(transactionCharges).where(eq(transactionCharges.transactionId, id)).all(),
        children: d.select().from(transactions).where(eq(transactions.parentId, id)).all().filter((c) => !c.deletedAt).map((c) => toListRowFromDb(d, c)),
        parent: t.parentId ? toListRowFromDb(d, d.select().from(transactions).where(eq(transactions.id, t.parentId)).get()!) : null,
        attachments: attachmentsOf(d, { transactionId: id }),
        split: splitOf(d, id),
        splitCurrency: t.kind === 'expense' ? chargedCurrencyOf(d, t) : t.currency,
        accounts: new Map(accountRows.map((a) => [a.id, a])),
        categories: name(d.select().from(categories).all()),
        ledgers: name(d.select().from(ledgers).all()),
        people: name(d.select().from(people).all()),
      };
    },
    [id],
  );

  if (!data) return null;
  const { t, row, charges, children, parent } = data;
  const account = t.accountId ? data.accounts.get(t.accountId) : undefined;
  const to = t.toAccountId ? data.accounts.get(t.toAccountId) : undefined;
  const sign = amountSign(row);
  const amountColor = row.amount.tone === 'expense' ? colors.expense : row.amount.tone === 'income' ? colors.income : colors.ink;
  const title = rowTitle(row);
  const toDelete = deleting ? deletionSet(db, id) : [];

  // ── Receipt: shown when there are charges or a conversion ──
  const receipt: { key: string; label: ReactNode; amount?: ReactNode; strong?: boolean; highlight?: boolean }[] = [];
  const converts = !!t.rate;
  if (charges.length || converts) {
    const receiving = t.kind === 'transfer' ? to : account;
    // Statement-style receipt (owner, Nov 13): data/receipt builds the lines for both screens.
    const before = charges.filter((c) => c.deduction === 'already_deducted' && (!converts || c.currency !== receiving?.currency));
    const insideMain = before.reduce((sum, c) => (c.currency === t.currency ? sum.minus(dec(c.amount)) : sum), dec(t.amount));
    const kind = t.kind === 'income' ? 'income' : t.kind === 'transfer' ? 'transfer' : 'expense';
    const rows = buildReceiptRows({
      kind,
      from: kind !== 'income' && account ? account : null,
      to: kind === 'income' ? (account ?? null) : kind === 'transfer' ? (to ?? null) : null,
      amount: t.amount,
      currency: t.currency,
      accountAmount: t.accountAmount,
      arrives: kind === 'transfer' ? t.toAmount : kind === 'income' ? t.accountAmount : null,
      conversion: converts && receiving ? { amount: insideMain.toFixed(), rate: t.rate!, from: t.currency, to: receiving.currency } : null,
      charges: charges.map((c) => ({ key: c.id, deduction: c.deduction, accountId: c.accountId, amount: c.amount, currency: c.currency })),
    });
    receipt.push(
      ...receiptLines(rows, {
        kind,
        charges: new Map(charges.map((c) => [c.id, { name: chargeLabel({ ...c, rate: c.rate, rateMode: c.rateMode, accountId: c.accountId, label: c.label }).name, tax: !!c.isTax || c.type === 'withholding_tax' }])),
        accountName: (aid) => (aid ? (data.accounts.get(aid)?.name ?? null) : null),
        pending: t.status !== 'cleared',
      }).map((l) => ({ key: l.key, label: l.label, amount: l.amount, highlight: l.highlight, strong: l.highlight })),
    );
  }
  const vs = vsMarketPercent(t.rate, t.marketRateAtEntry);

  // ── Fields: empty ones hidden ──
  const fields: [string, ReactNode, string?][] = [];
  if (t.categoryId) fields.push([s.category, data.categories.get(t.categoryId)]);
  if (t.referencePersonId) fields.push([s.tagged, data.people.get(t.referencePersonId)]);
  if (t.paidByPersonId) fields.push([s.paidBy, data.people.get(t.paidByPersonId)]);
  if (t.ledgerId) fields.push([s.ledger, data.ledgers.get(t.ledgerId)]);
  if (t.kind !== 'opening_balance' && t.kind !== 'balance_adjustment') fields.push([s.status, t.status === 'cancelled' ? strings.review.cancelled : strings.add.statuses[t.status]]);
  if (t.expectedDate) fields.push([s.expected, formatLongDate(t.expectedDate)]);
  if (t.reimbursable && t.reimbursementStatus) {
    fields.push([
      s.reimbursable,
      `${s.reimbursement[t.reimbursementStatus]}${t.expectedFromPersonId ? s.fromPerson(data.people.get(t.expectedFromPersonId) ?? '') : ''}`,
      t.reimbursementStatus === 'reimbursed' ? colors.income : undefined,
    ]);
    // Its separate charges are expected back too: show how much of them came back (owner, Nov 15).
    const ch = chargesOf(db, t);
    if (ch.total.gt(0)) {
      const money = (v: string) => <Money value={v} currency={ch.currency} allowCompact={false} />;
      fields.push([
        s.chargesBackLabel,
        <>{parts(ch.back.gte(ch.total) ? s.chargesAllBack(money(toDecimalString(ch.total))) : s.chargesSomeBack(money(toDecimalString(ch.back)), money(toDecimalString(ch.total))))}</>,
        ch.back.gte(ch.total) ? colors.income : undefined,
      ]);
    }
  }
  if (vs) fields.push([s.vsMarket, strings.add.signedPct(vs)]);
  // The first line of the notes is the title when nothing else names it; show only the rest.
  const noteLines = t.notes?.split('\n') ?? [];
  const restOfNotes = noteLines[0]?.trim() === title ? noteLines.slice(1).join('\n').trim() : t.notes?.trim();
  if (restOfNotes) fields.push([s.notes, restOfNotes]);

  const editable = t.kind === 'expense' || t.kind === 'income' || t.kind === 'transfer';
  // Linked entries are added from here: Got it on a reimbursable expense, Add refund on any cleared expense paid from an account.
  const waitingBack = t.reimbursable && (t.reimbursementStatus === 'awaiting' || t.reimbursementStatus === 'partly_back') && t.status === 'cleared';
  const refundable = t.kind === 'expense' && !t.linkType && !!t.accountId && t.status === 'cleared' && !t.scheduled;
  const linkedAccounts = [...new Set(toDelete.flatMap((x) => [x.accountId, x.toAccountId]).filter(Boolean))].map((a) => data.accounts.get(a!)?.name).filter(Boolean);

  return (
    <Screen>
      <Header size={18} title={s.title} onBack={goBack} />
      {action.ui}

      <Card style={styles.hero}>
        <IconChip icon={row.icon.name} color={row.icon.color} size={46} />
        <Text style={[styles.heroTitle, { color: colors.ink }, row.cancelled && styles.struck]}>{title}</Text>
        <Money value={row.amount.value} currency={row.amount.currency} sign={sign} allowCompact={false} style={[styles.heroAmount, { color: amountColor }, row.cancelled && styles.struck]} />
        {row.sent ? (
          <Text style={[styles.heroMeta, { color: colors.inkMuted }]}>
            <Money value={row.sent.value} currency={row.sent.currency} sign="never" allowCompact={false} style={styles.heroMeta} /> {strings.list.sent}
          </Text>
        ) : null}
        <Text style={[styles.heroMeta, { color: colors.inkMuted }]}>{[formatLongDate(t.date), row.accountName].filter(Boolean).join(' · ')}</Text>
      </Card>
      {row.cancelled ? <Text style={[styles.note, { color: colors.inkSecondary, backgroundColor: colors.filled }]}>{s.cancelledNote}</Text> : null}

      {receipt.length ? (
        <View>
          <Text style={[styles.label, { color: colors.inkMuted }]}>{s.receipt}</Text>
          <Card style={styles.receipt}>
            {receipt.map((l, i) => (
              <View
                key={l.key}
                style={[
                  styles.receiptLine,
                  l.highlight ? { backgroundColor: colors.filled, borderRadius: 8, paddingHorizontal: 8, marginVertical: 4 } : i < receipt.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.line } : null,
                ]}
              >
                <Text style={[styles.receiptLabel, { color: l.strong ? colors.accent : l.highlight ? colors.ink : colors.inkSecondary }, (l.strong || l.highlight) && { fontFamily: fonts.sansBold }]}>{l.label}</Text>
                {l.amount ?? null}
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {children.length || parent ? (
        <View>
          <Text style={[styles.label, { color: colors.inkMuted }]}>{parent ? s.parentOf.toUpperCase() : s.linked}</Text>
          <Card>
            {(parent ? [parent] : children).map((c, i, list) => (
              <LinkedRow
                key={c.id}
                title={rowTitle(c)}
                detail={
                  parent
                    ? formatLongDate(c.date)
                    : [formatLongDate(c.date), c.linkType === 'reimbursement' ? s.gotIt : null, s.linkedNote(formatShortDate(c.date))].filter(Boolean).join(' · ')
                }
                amount={
                  <MoneyInline
                    value={c.amount.tone === 'expense' ? `-${c.amount.value}` : c.amount.value}
                    currency={c.amount.currency}
                    tone={c.amount.tone === 'neutral' ? undefined : c.amount.tone}
                    sign={c.amount.tone === 'income' ? 'always' : undefined}
                  />
                }
                last={i === list.length - 1}
                onPress={() => router.push(`/transaction/${c.id}`)}
              />
            ))}
          </Card>
        </View>
      ) : null}

      {fields.length ? (
        <Card style={styles.fields}>
          {fields.map(([label, value, tint], i) => (
            <View key={label} style={[styles.field, i < fields.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
              <Text style={[styles.fieldLabel, { color: colors.inkMuted }]}>{label}</Text>
              <Text style={[styles.fieldValue, { color: tint ?? colors.ink }]}>{value}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {data.split ? (
        <View>
          <Text style={[styles.label, { color: colors.inkMuted }]}>{s.split}</Text>
          <Card style={styles.fields}>
            {data.split.shares.map((sh, i, list) => {
              const name = sh.personId ? (data.people.get(sh.personId) ?? '') : strings.split.you;
              const detail = !sh.personId
                ? t.paidByPersonId
                  ? strings.split.youOwe(data.people.get(t.paidByPersonId) ?? '')
                  : strings.split.yourShare
                : t.paidByPersonId
                  ? sh.personId === t.paidByPersonId
                    ? strings.split.payerRow
                    : strings.split.notTracked(data.people.get(t.paidByPersonId) ?? '')
                  : sh.treat
                    ? strings.split.treated
                    : strings.split.owesYou;
              return (
                <View key={sh.personId ?? 'you'} style={[styles.field, i < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fieldValue, { color: colors.ink, textAlign: 'left' }]}>{name}</Text>
                    <Text style={[styles.small, { color: colors.inkMuted }]}>{detail}</Text>
                  </View>
                  <MoneyInline value={sh.amount} currency={data.splitCurrency} size={13} />
                </View>
              );
            })}
          </Card>
          {children.some((c) => c.linkType === 'refund') ? (
            <View style={{ marginTop: 8 }}>
              <SharesKeptNote expenseId={id} />
            </View>
          ) : null}
        </View>
      ) : null}

      {data.attachments.length ? (
        <View>
          <Text style={[styles.label, { color: colors.inkMuted }]}>{s.attachments(data.attachments.length)}</Text>
          <View style={styles.files}>
            {data.attachments.map((a) => {
              const ext = (a.filePath.split('.').pop() ?? '').toUpperCase();
              return (
                <View key={a.id} style={[styles.file, { borderColor: colors.line }]}>
                  <View style={[styles.fileType, { backgroundColor: colors.filled }]}>
                    <Text style={[styles.fileTypeText, { color: colors.inkSecondary }]}>{ext.slice(0, 4)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.fileName, { color: colors.ink }]} numberOfLines={1}>
                      {a.mimeType.startsWith('image/') ? s.photo : s.file}
                    </Text>
                    <Text style={[styles.fileMeta, { color: colors.inkMuted }]}>{formatBytes(a.sizeBytes)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {editable && !row.cancelled ? (
        <View style={styles.buttons}>
          <Button label={s.edit} style={{ flex: 1 }} onPress={() => router.push(`/transaction/${id}/edit`)} />
          {!t.linkType ? <Button kind="secondary" label={s.duplicate} style={{ flex: 1 }} onPress={() => router.push({ pathname: '/transaction/new', params: { duplicate: id } })} /> : null}
        </View>
      ) : null}
      {waitingBack && !row.cancelled ? <Button kind="secondary" label={strings.review.gotIt} onPress={() => setGotIt(true)} /> : null}
      {refundable ? <Button kind="secondary" label={s.addRefund} onPress={() => router.push(`/transaction/${id}/refund`)} /> : null}
      {editable ? (
        row.cancelled ? (
          <Button kind="secondary" label={s.restore} onPress={() => action.run(() => restoreCancelled(db, id))} />
        ) : (
          <LinkButton label={s.cancel} onPress={() => action.run(() => cancelTransaction(db, id))} />
        )
      ) : null}
      <Button kind="danger" label={s.delete} onPress={() => setDeleting(true)} />

      <BottomSheet visible={deleting} onClose={() => setDeleting(false)}>
        <View style={{ gap: 12 }}>
          <Text style={[styles.sheetTitle, { color: colors.ink }]}>{s.deleteTitle(title)}</Text>
          {toDelete.length > 1 ? <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.deleteLinked}</Text> : null}
          {toDelete.length > 1
            ? toDelete.map((x) => {
                const r = toListRowFromDb(db, x);
                return (
                  <View key={x.id} style={[styles.deleteRow, { borderBottomColor: colors.line }]}>
                    <Text style={[styles.body, { color: colors.ink, flex: 1 }]}>
                      {x.parentId ? '↳ ' : ''}
                      {rowTitle(r)} · {formatShortDate(x.date)}
                    </Text>
                    <MoneyInline value={r.amount.tone === 'expense' ? `-${r.amount.value}` : r.amount.value} currency={r.amount.currency} tone={r.amount.tone === 'neutral' ? undefined : r.amount.tone} size={13} />
                  </View>
                );
              })
            : null}
          {linkedAccounts.length ? <Text style={[styles.small, { color: colors.inkMuted }]}>{s.deleteBalances(linkedAccounts as string[])}</Text> : null}
          <Button
            label={s.deleteN(toDelete.length)}
            style={{ backgroundColor: colors.expense }}
            onPress={() => {
              setDeleting(false);
              const result = action.run(() => deleteTransaction(db, id));
              if (result) {
                deleteStoredFiles(result.attachmentPaths);
                toast({ message: s.deletedToast });
                router.back();
              }
            }}
          />
          <Button kind="secondary" label={s.keep(toDelete.length)} onPress={() => setDeleting(false)} />
        </View>
      </BottomSheet>
      <GotItSheet expenseId={gotIt ? id : null} onClose={() => setGotIt(false)} />
    </Screen>
  );
}

function LinkedRow({ title, detail, amount, last, onPress }: { title: string; detail: string; amount: ReactNode; last: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.linked, !last && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
      <IconChip icon="tick" color="teal" size={30} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.linkedTitle, { color: colors.ink }]} onPress={onPress}>
          {title}
        </Text>
        <Text style={[styles.small, { color: colors.inkMuted }]}>{detail}</Text>
      </View>
      {amount}
    </View>
  );
}


const styles = StyleSheet.create({
  hero: { alignItems: 'center', padding: 20, gap: 4 },
  heroTitle: { fontFamily: fonts.sansSemiBold, fontSize: 15, marginTop: 6, textAlign: 'center' },
  heroAmount: { fontFamily: fonts.monoSemiBold, fontSize: 30 },
  heroMeta: { fontFamily: fonts.sans, fontSize: 12.5 },
  struck: { textDecorationLine: 'line-through' },
  note: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, borderRadius: radius.field, padding: 12 },
  label: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 6, paddingHorizontal: 2 },
  receipt: { paddingHorizontal: 16, paddingVertical: 8 },
  receiptLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, gap: 10 },
  receiptLabel: { fontFamily: fonts.sans, fontSize: 13, flexShrink: 1 },
  fields: { paddingHorizontal: 16, paddingVertical: 6 },
  field: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, gap: 16 },
  fieldLabel: { fontFamily: fonts.sans, fontSize: 13 },
  fieldValue: { fontFamily: fonts.sansSemiBold, fontSize: 13, flexShrink: 1, textAlign: 'right' },
  files: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  file: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: radius.field, padding: 10, flexDirection: 'row', gap: 9, alignItems: 'center' },
  fileType: { width: 34, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  fileTypeText: { fontFamily: fonts.sansExtraBold, fontSize: 9 },
  fileName: { fontFamily: fonts.sansSemiBold, fontSize: 12 },
  fileMeta: { fontFamily: fonts.sans, fontSize: 10.5 },
  buttons: { flexDirection: 'row', gap: 10 },
  linked: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 12 },
  linkedTitle: { fontFamily: fonts.sansSemiBold, fontSize: 13.5 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 19 },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  deleteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1 },
});
