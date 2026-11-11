import { and, eq, isNull } from 'drizzle-orm';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AmountTextInput } from '@/components/AmountTextInput';
import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { CurrencySheet } from '@/components/sheets/CurrencySheet';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { useLedgerItems } from '@/components/sheets/pickers';
import { BottomSheet, Button, Header, IconButton, IconChip, LinkButton, Screen, Segmented, SelectorRow } from '@/components/ui';
import { createBudget, deleteBudget, updateBudget, type Budget } from '@/data/budgets';
import { db } from '@/db/client';
import { budgets, categories, ledgers } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { Decimal, dec, parseTypedAmount, toDecimalString, toTypedText } from '@/lib/money';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { goBack } from '@/state/nav';
import { useSettings } from '@/state/settings';
import { fonts, radius, useTheme } from '@/theme';

/** Add budget / Edit budget: ledger, currency, whole ledger or one category, period, amount. */
export function BudgetForm({ budget, ledgerId: initialLedger }: { budget?: Budget; ledgerId?: string }) {
  const s = strings.budgets;
  const { colors } = useTheme();
  const settings = useSettings();
  const action = useAction();
  const defaultLedger = useLive((d) => d.select({ id: ledgers.id }).from(ledgers).where(eq(ledgers.isDefault, true)).get()?.id ?? null);
  const [ledgerId, setLedgerId] = useState<string | null>(budget?.ledgerId ?? initialLedger ?? null);
  const [currency, setCurrency] = useState(budget?.currency ?? settings.defaultCurrency);
  const [scope, setScope] = useState<'whole' | 'category'>(budget ? (budget.categoryId ? 'category' : 'whole') : 'category');
  const [categoryId, setCategoryId] = useState<string | null>(budget?.categoryId ?? null);
  const [period, setPeriod] = useState<'monthly' | 'yearly'>(budget?.period === 'yearly' ? 'yearly' : 'monthly');
  const [text, setText] = useState(budget ? toTypedText(budget.amount, settings.numberFormat) : '');
  const [sheet, setSheet] = useState<'ledger' | 'currency' | 'category' | 'delete' | null>(null);
  const ledger = ledgerId ?? defaultLedger;
  const ledgerItems = useLedgerItems();
  const info = useLive(
    (d) => ({
      ledgerName: ledger ? (d.select({ n: ledgers.name }).from(ledgers).where(eq(ledgers.id, ledger)).get()?.n ?? '') : '',
      category: categoryId ? d.select().from(categories).where(eq(categories.id, categoryId)).get() : undefined,
      tops: d.select().from(categories).where(and(eq(categories.kind, 'expense'), isNull(categories.parentId), isNull(categories.archivedAt))).orderBy(categories.rank).all(),
      others: ledger ? d.select().from(budgets).where(and(eq(budgets.ledgerId, ledger), eq(budgets.currency, currency))).all() : [],
    }),
    [ledger, categoryId, currency],
  );
  const amount = parseTypedAmount(text, settings.numberFormat);
  const canSave = !!ledger && !!amount && dec(amount).gt(0) && (scope === 'whole' || !!categoryId);

  // Heads-up when category budgets would add up to more than the whole-ledger cap.
  const others = info.others.filter((b) => b.id !== budget?.id && b.period === period);
  const whole = scope === 'whole' ? amount : (others.find((b) => !b.categoryId)?.amount ?? null);
  const catSum = others.filter((b) => b.categoryId).reduce((sum, b) => sum.plus(dec(b.amount)), new Decimal(0)).plus(scope === 'category' && amount ? dec(amount) : 0);
  const overBy = whole && catSum.gt(dec(whole)) ? toDecimalString(catSum.minus(dec(whole))) : null;
  const money = (v: string) => <Money value={v} currency={currency} allowCompact={false} style={[styles.inline, { color: colors.warning }]} />;

  const save = () => {
    if (!canSave || !ledger) return;
    const input = { ledgerId: ledger, categoryId: scope === 'category' ? categoryId : null, currency, amount: amount!, period };
    if (action.run(() => (budget ? updateBudget(db, budget.id, input) : createBudget(db, input), true))) goBack();
  };

  return (
    <Screen>
      <Header title={budget ? s.edit : s.add} onBack={goBack} backIcon="close" actions={<IconButton icon="tick" filled label={s.save} onPress={save} disabled={!canSave} />} />
      {action.ui}
      <SelectorRow label={s.ledger} value={info.ledgerName || '—'} onPress={() => setSheet('ledger')} />
      <SelectorRow label={s.currency} value={currency} onPress={() => setSheet('currency')} />
      <View style={{ gap: 6 }}>
        <Segmented
          options={[
            { value: 'whole', label: s.scope.whole },
            { value: 'category', label: s.scope.category },
          ]}
          value={scope}
          onChange={setScope}
        />
        {scope === 'category' ? (
          <SelectorRow
            label={s.category}
            value={info.category?.name ?? s.pickCategory}
            leading={info.category ? <IconChip icon={info.category.icon} color={info.category.color} size={26} /> : undefined}
            onPress={() => setSheet('category')}
          />
        ) : null}
      </View>
      <View>
        <Text style={[styles.label, { color: colors.inkMuted }]}>{s.period}</Text>
        <Segmented options={(['monthly', 'yearly'] as const).map((p) => ({ value: p, label: s.periods[p] }))} value={period} onChange={setPeriod} />
      </View>
      <View>
        <Text style={[styles.label, { color: colors.inkMuted }]}>{s.amount}</Text>
        <View style={[styles.amountBox, { backgroundColor: colors.filled }]}>
          <Text style={[styles.code, { color: colors.inkSecondary }]}>{currency}</Text>
          <AmountTextInput value={text} onChangeText={setText} keyboardType="numeric" placeholder="0.00" placeholderTextColor={colors.inkMuted} style={[styles.amountInput, { color: colors.ink }]} />
        </View>
      </View>
      {overBy && whole ? (
        <View style={[styles.warn, { backgroundColor: colors.warningSoft, borderColor: colors.warning + '55' }]}>
          <Icon name="bolt" size={16} color={colors.warning} strokeWidth={2} />
          <Text style={[styles.warnText, { color: colors.warning }]}>{parts(s.formOverlap(info.ledgerName, money(toDecimalString(catSum)), money(overBy), money(whole)))}</Text>
        </View>
      ) : null}
      <Button label={s.save} disabled={!canSave} onPress={save} />
      {budget ? <LinkButton danger label={s.delete} onPress={() => setSheet('delete')} /> : null}

      <PickerSheet visible={sheet === 'ledger'} title={strings.ledgers.title} sections={[{ items: ledgerItems }]} selectedId={ledger} onSelect={setLedgerId} onClose={() => setSheet(null)} />
      <CurrencySheet visible={sheet === 'currency'} selected={currency} onSelect={setCurrency} onClose={() => setSheet(null)} />
      <PickerSheet
        visible={sheet === 'category'}
        title={s.pickCategory}
        sections={[{ items: info.tops.map((c) => ({ id: c.id, title: c.name, leading: <IconChip icon={c.icon} color={c.color} size={30} /> })) }]}
        selectedId={categoryId}
        onSelect={setCategoryId}
        onClose={() => setSheet(null)}
      />
      <BottomSheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title={s.delete}>
        <View style={{ gap: 12 }}>
          <Button
            label={s.delete}
            style={{ backgroundColor: colors.expense }}
            onPress={() => {
              if (budget && action.run(() => (deleteBudget(db, budget.id), true))) goBack();
            }}
          />
          <Button kind="secondary" label={strings.common.cancel} onPress={() => setSheet(null)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 5 },
  amountBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.field, paddingHorizontal: 14 },
  code: { fontFamily: fonts.sansBold, fontSize: 11 },
  amountInput: { flex: 1, fontFamily: fonts.mono, fontSize: 22, paddingVertical: 12 },
  warn: { flexDirection: 'row', gap: 9, borderRadius: radius.field, borderWidth: 1.5, padding: 12 },
  warnText: { flex: 1, fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  inline: { fontFamily: fonts.monoSemiBold, fontSize: 12 },
});
