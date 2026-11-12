import { goBack } from '@/state/nav';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { eq, isNull } from 'drizzle-orm';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { ConversionTrio } from '@/components/AmountBox';
import { Keypad } from '@/components/Keypad';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { AttachSheet } from '@/components/sheets/AttachSheet';
import { CurrencySheet } from '@/components/sheets/CurrencySheet';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import {
  AccountOrPersonSheet,
  Initials,
  useAccountSections,
  useCategorySections,
  useGoalItems,
  useLedgerItems,
  usePeopleItems,
} from '@/components/sheets/pickers';
import { BottomSheet, Button, Header, IconButton, Segmented, ToggleRow } from '@/components/ui';
import { vsMarketPercent, type AmountResult } from '@/data/amounts';
import { attachmentsOf } from '@/data/attachments';
import { accountBalances } from '@/data/balances';
import { addToGoal, stillToGo } from '@/data/goals';
import { personBalances } from '@/data/owing';
import { marketRate } from '@/data/rates';
import { CHARGE_TYPES, NOTES_MAX, prepareTransaction, saveTransaction, type ChargeDraft, type ChargeType } from '@/data/transactions';
import { budgetWarning } from '@/data/budgets';
import { accountFree, currencyPositions, spendWarning, upcomingOnAccount } from '@/data/usable';
import { db } from '@/db/client';
import { exportedPeriodFor } from '@/data/tax-export';
import { accounts, categories, ledgers, people, transactionCharges } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { expressionValue, hasOperator } from '@/lib/calc';
import { today as todayDate } from '@/lib/dates';
import { formatShortDate } from '@/lib/format-date';
import { add, dec, toDecimalString, formatAmount, formatTyped, getCurrency, isDecimalString } from '@/lib/money';
import { deleteStoredFiles, storeFiles } from '@/services/attachments';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { useToast } from '@/state/toast';
import {
  commitCharges,
  editCharge,
  isForcedTax,
  liveCharges,
  needsRate,
  newChargeEdit,
  pressChargeKey,
  chargeAmount,
  withAccount,
  withDeduction,
  withType,
  type ChargeContext,
  type ChargeEdit,
} from '@/state/charge-edit';
import { RATE_MAX_DECIMALS, applyKey, draftFromForm, focusConversion, splitForTotal, switchKind, type FormKind, type FormState } from '@/state/transaction-form';
import { fonts, useTheme } from '@/theme';
import { ChargeEditor, ChargeEditorHint } from './ChargeEditor';
import { SplitEditor } from './SplitEditor';
import { Tour, TourTarget } from '@/components/tour/Tour';
import { AmountCard, FormRow, MoneyInline, ReceiptCard, RowNote, UtilityButton, chargeLabel, formatLongDate, trimRate, type ReceiptLine } from './parts';

type Sheet =
  | 'charges'
  | 'from'
  | 'to'
  | 'category'
  | 'tag'
  | 'status'
  | 'expectedBack'
  | 'split'
  | 'ledger'
  | 'notes'
  | 'attach'
  | 'currency'
  | 'rate'
  | 'goal'
  | 'goalAccount'
  | null;

/**
 * Add transaction (Spec §11): Expense, Income, Transfer, Savings on one screen,
 * a calculator keypad for the amount, another currency inline, and charges as a
 * receipt behind the Charges button. ✓ saves and goes back. Edit uses the same
 * screen, filled in (`editId`).
 */
export function TransactionForm({ initial, editId }: { initial: FormState; editId?: string }) {
  const s = strings.add;
  const settings = useSettings();
  const { colors, swatch } = useTheme();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(initial);
  const [sheet, setSheet] = useState<Sheet>(null);
  const action = useAction();
  const today = todayDate();
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // ── Lookups ──
  const ref = useLive((d) => ({
    accounts: new Map(d.select().from(accounts).all().map((a) => [a.id, a])),
    people: new Map(d.select().from(people).all().map((p) => [p.id, p])),
    categories: new Map(d.select().from(categories).all().map((c) => [c.id, c])),
    ledgers: new Map(d.select().from(ledgers).all().map((l) => [l.id, l])),
    balances: accountBalances(d),
    firstAccount: d.select({ id: accounts.id }).from(accounts).where(isNull(accounts.archivedAt)).orderBy(accounts.rank).get()?.id ?? null,
  }));
  const goals = useGoalItems();
  const categorySections = useCategorySections(form.kind === 'income' ? 'income' : 'expense');
  const peopleItems = usePeopleItems();
  const ledgerItems = useLedgerItems();
  const goal = goals.find((g) => g.id === form.goalId) ?? null;
  const goalAccountSections = useAccountSections({ currency: goal?.currency ?? '—', showFree: true });
  const chargeAccountSections = useAccountSections();

  const fromAccount = form.from?.type === 'account' ? (ref.accounts.get(form.from.id) ?? null) : null;
  const toAccount = form.to?.type === 'account' ? (ref.accounts.get(form.to.id) ?? null) : null;
  const fromPerson = form.from?.type === 'person' ? (ref.people.get(form.from.id) ?? null) : null;
  const toPerson = form.to?.type === 'person' ? (ref.people.get(form.to.id) ?? null) : null;
  // A transfer with a person moves their balance in this currency only (Nov 7). When they owe only in
  // other currencies, this would start a new balance instead of clearing theirs: point to Settle up.
  const transferPerson = form.kind === 'transfer' && !form.personSettle ? (fromPerson ?? toPerson) : null;
  const personBalancesNow = useLive((d) => (transferPerson ? [...personBalances(d, transferPerson.id).entries()].filter(([, b]) => !dec(b).isZero()) : []), [transferPerson?.id]);
  const goalAccount = form.goalAccountId ? (ref.accounts.get(form.goalAccountId) ?? null) : null;

  // ── Currencies and amounts ──
  const isSavings = form.kind === 'savings';
  const mainCurrency =
    isSavings
      ? (goal?.currency ?? settings.defaultCurrency)
      : form.kind === 'transfer'
        ? (fromAccount?.currency ?? toAccount?.currency ?? settings.defaultCurrency)
        : (form.currency ?? fromAccount?.currency ?? settings.defaultCurrency);
  const receivingCurrency =
    form.kind === 'transfer' ? (toAccount?.currency ?? mainCurrency) : (fromAccount?.currency ?? mainCurrency);
  const converts = !isSavings && mainCurrency !== receivingCurrency && (form.kind !== 'transfer' || (!!fromAccount && !!toAccount));
  const amount = expressionValue(form.expression, getCurrency(mainCurrency).minorUnits);
  const known = expressionValue(form.knownExpression, getCurrency(receivingCurrency).minorUnits);
  // The rate is typed on the keypad (option D); only a positive result counts.
  const typedRate = expressionValue(form.rateText, RATE_MAX_DECIMALS);
  const rate = typedRate && isDecimalString(typedRate) && dec(typedRate).gt(0) ? typedRate : null;
  const market = useLive((d) => (converts ? marketRate(d, mainCurrency, receivingCurrency) : null), [converts, mainCurrency, receivingCurrency]);

  // ── Charges page (Decided Nov 11, option D): one charge at a time in the panel above the keypad ──
  const [chargeEdit, setChargeEdit] = useState<ChargeEdit | null>(null);
  // The charges as they were when the page opened: ✕ goes back to these (after a warning).
  const [chargesBefore, setChargesBefore] = useState<ChargeDraft[]>([]);
  const [chargeSheet, setChargeSheet] = useState<'type' | 'account' | 'currency' | 'discard' | null>(null);
  const chargeCtx: ChargeContext = {
    mainCurrency,
    receivingCurrency,
    defaultAccountId: (form.kind === 'transfer' ? toAccount?.id : null) ?? fromAccount?.id ?? null,
    accountCurrency: (id) => ref.accounts.get(id)?.currency,
  };
  // While a charge is being typed, the receipt and "goes up by" count it as soon as it's complete.
  const liveForm = chargeEdit ? { ...form, charges: liveCharges(form.charges, chargeEdit, chargeCtx) } : form;

  // Types you've named before (custom charges already saved) come back in the list.
  const customTypes = useLive(
    (d) =>
      d
        .selectDistinct({ label: transactionCharges.label })
        .from(transactionCharges)
        .where(eq(transactionCharges.type, 'custom'))
        .all()
        .map((r) => r.label)
        .filter((l): l is string => !!l),
    [],
  );
  const chargeTypeSections = [
    {
      items: CHARGE_TYPES.filter((t) => t !== 'custom').map((t) => ({ id: t, title: strings.charge.types[t], detail: strings.charge.typeNotes[t] })),
    },
    ...(customTypes.length ? [{ label: strings.charge.yourTypes, items: customTypes.map((l) => ({ id: `custom:${l}`, title: l })) }] : []),
  ];

  /** The charges with the open edit kept (when it's complete). */
  const committed = () => commitCharges(form.charges, chargeEdit, chargeCtx);
  const openCharges = () => {
    setChargesBefore(form.charges);
    setChargeEdit(null);
    setSheet('charges');
    // Nothing yet: start the first charge straight away; its type list opens once the page is up (onShow).
    if (!form.charges.length) setChargeEdit(newChargeEdit('transfer_fee', chargeCtx));
  };
  const startNewCharge = () => {
    set({ charges: committed() });
    setChargeEdit(newChargeEdit('transfer_fee', chargeCtx));
    setChargeSheet('type');
  };
  const selectCharge = (i: number) => {
    if (chargeEdit?.index === i) return;
    const list = committed();
    set({ charges: list });
    setChargeEdit(editCharge(list[i], i));
  };
  const removeCharge = () => {
    if (chargeEdit?.index !== null && chargeEdit?.index !== undefined) {
      const index = chargeEdit.index;
      set({ charges: form.charges.filter((_, i) => i !== index) });
    }
    setChargeEdit(null);
  };
  /** ✓ and the arrow on the receipt: keep the charges and go back to the form. */
  const doneCharges = () => {
    set({ charges: committed() });
    setChargeEdit(null);
    setChargeSheet(null);
    setSheet(null);
  };
  const discardCharges = () => {
    set({ charges: chargesBefore });
    setChargeEdit(null);
    setChargeSheet(null);
    setSheet(null);
  };
  /** ✕ and Back: drop this visit's changes, after a warning when there are any. */
  const cancelCharges = () => {
    if (JSON.stringify(committed()) === JSON.stringify(chargesBefore)) return discardCharges();
    setChargeSheet('discard');
  };

  // What the draft would save, worked out on every render (a few synchronous reads).
  const preview: { result: AmountResult | null; error: string | null } = (() => {
    if (isSavings || !amount || dec(amount).lte(0)) return { result: null, error: null };
    try {
      return { result: prepareTransaction(db, draftFromForm(liveForm, { amount, knownAmount: known, rate, mainCurrency })), error: null };
    } catch (e) {
      return { result: null, error: (e as { code?: string }).code ?? null };
    }
  })();

  const outOfAccount =
    (form.kind === 'expense' || form.kind === 'transfer') && fromAccount && preview.result ? preview.result.accountAmount : null;
  const warning = useLive((d) => (fromAccount && outOfAccount ? spendWarning(d, fromAccount.id, outOfAccount) : null), [fromAccount?.id, outOfAccount]);
  // Budget warning (Spec §11 — Decided): the category's budget in this ledger only; when this takes it over, or it's already over.
  const budget = useLive(
    (d) =>
      form.kind === 'expense' && fromAccount && outOfAccount
        ? budgetWarning(d, { ledgerId: form.ledgerId, categoryId: form.categoryId, currency: fromAccount.currency, amount: outOfAccount, date: form.date })
        : null,
    [form.kind, fromAccount?.id, outOfAccount, form.ledgerId, form.categoryId, form.date],
  );
  const upcoming = useLive((d) => (fromAccount && !isSavings ? upcomingOnAccount(d, fromAccount.id) : null), [fromAccount?.id, isSavings]);
  const goalFree = useLive((d) => (goalAccount ? accountFree(d, goalAccount.id).free : null), [goalAccount?.id]);
  // Raising a goal past what the currency has (Decided Nov 7): allowed, with a red warning; Usable goes negative.
  const currencyUsable = useLive((d) => (isSavings && goal ? (currencyPositions(d).get(goal.currency)?.usable ?? '0') : null), [isSavings, goal?.currency]);
  const savingsOver = currencyUsable !== null && amount && dec(amount).gt(dec(currencyUsable)) ? toDecimalString(dec(amount).minus(dec(currencyUsable))) : null;

  // ── Actions ──
  const onKey = (key: Parameters<typeof applyKey>[1]) =>
    setForm((f) => {
      const g = converts || f.target === 'amount' ? f : { ...f, target: 'amount' as const };
      return applyKey(g, key, getCurrency(g.target === 'known' ? receivingCurrency : mainCurrency).minorUnits);
    });
  const changeKind = (kind: FormKind) => {
    setForm((f) => switchKind(f, kind, { date: today, accountId: ref.firstAccount }));
  };
  const pickDate = (value: string, onPick: (d: string) => void) => {
    const [y, m, d] = value.split('-').map(Number);
    DateTimePickerAndroid.open({
      value: new Date(y, m - 1, d),
      mode: 'date',
      onChange: (event, picked) => {
        if (event.type === 'set' && picked) onPick(todayDate(picked));
      },
    });
  };

  const canSave = isSavings ? !!(goal && goalAccount && amount && dec(amount).gt(0)) : !!amount && dec(amount).gt(0);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!canSave || !amount || saving) return;
    setSaving(true);
    const picked = form.attachments.picked;
    const ok = await action.runAsync(async () => {
      // Files go into the app's folder first; if the save then fails, they're removed again.
      const stored = await storeFiles(picked);
      const add = stored.map((filePath, i) => ({ filePath, mimeType: picked[i].mimeType, sizeBytes: picked[i].sizeBytes }));
      try {
        if (isSavings) {
          addToGoal(db, { goalId: goal!.id, accountId: goalAccount!.id, amount, date: form.date, notes: form.notes, attachments: add });
        } else {
          const draft = draftFromForm(form, { amount, knownAmount: known, rate, mainCurrency });
          // Equal and Percent shares follow the amount as it is now.
          if (draft.split) {
            const total = draft.fromPersonId ? amount : preview.result?.accountAmount;
            const currency = draft.fromPersonId ? mainCurrency : (fromAccount?.currency ?? mainCurrency);
            if (total) draft.split = splitForTotal(draft.split, total, currency);
          }
          const result = saveTransaction(db, draft, {
            id: editId,
            marketRate: converts ? market : null,
            attachments: { add, removeIds: form.attachments.removeIds },
          });
          deleteStoredFiles(result.removedAttachmentPaths);
        }
      } catch (e) {
        deleteStoredFiles(stored);
        throw e;
      }
      return true;
    });
    setSaving(false);
    if (!ok) return;
    if (!isSavings && form.date > today) {
      toast({ message: s.savedUpcoming(formatShortDate(form.date)), action: { label: 'View', onPress: () => router.push('/review') } });
    }
    router.back();
  };

  // ── Attachments ──
  const savedAttachments = useLive(
    (d) => (editId ? attachmentsOf(d, { transactionId: editId }).filter((a) => !form.attachments.removeIds.includes(a.id)) : []),
    [editId, form.attachments.removeIds],
  );
  const attachmentCount = savedAttachments.length + form.attachments.picked.length;

  // ── Charges receipt ──
  const charges = form.charges;
  const chargesTotal = (() => {
    if (!charges.length) return null;
    const currencies = new Set(charges.map((c) => c.currency));
    if (currencies.size > 1) return { text: `${charges.length}` as string, currency: null };
    return { text: add(...charges.map((c) => c.amount)), currency: charges[0].currency };
  })();
  const receivingName = form.kind === 'transfer' ? toAccount?.name : fromAccount?.name;
  const receiptLines = buildReceipt();

  function buildReceipt(): ReceiptLine[] {
    const r = strings.receipt;
    const lines: ReceiptLine[] = [];
    const amountMoney = amount ? <MoneyInline value={amount} currency={mainCurrency} /> : null;
    const chargeLine = (c: ChargeDraft, i: number | 'new'): ReceiptLine => {
      const { name, where } = chargeLabel(c);
      const editing = chargeEdit !== null && (chargeEdit.index ?? 'new') === i;
      const typed = editing ? chargeAmount(chargeEdit) : c.amount;
      return {
        key: `c${i}`,
        label: `− ${name} · ${where}`,
        amount: typed ? <MoneyInline value={`-${typed}`} currency={c.currency} tone="expense" /> : <Text style={{ color: colors.inkMuted }}>—</Text>,
        onPress: i === 'new' ? undefined : () => selectCharge(i),
        editing,
      };
    };
    // Every saved charge, with the one being edited shown as typed (even before it's complete).
    const editShown = (e: ChargeEdit): ChargeDraft => ({
      type: e.type,
      label: e.label,
      amount: chargeAmount(e) ?? '0',
      currency: e.currency,
      deduction: e.deduction,
      accountId: e.accountId,
      isTax: e.isTax,
    });
    const indexed: { c: ChargeDraft; i: number | 'new' }[] = form.charges.map((c, i) => ({ c: chargeEdit?.index === i ? editShown(chargeEdit) : c, i }));
    if (chargeEdit && chargeEdit.index === null) indexed.push({ c: editShown(chargeEdit), i: 'new' });
    const insideBefore = indexed.filter(({ c }) => c.deduction === 'already_deducted' && (!converts || c.currency !== receivingCurrency));
    const insideAfter = indexed.filter(({ c }) => c.deduction === 'already_deducted' && converts && c.currency === receivingCurrency);
    const onTop = indexed.filter(({ c }) => c.deduction === 'charged_separately');

    if (form.kind === 'expense') {
      if (amountMoney) lines.push({ key: 'main', label: fromAccount ? r.whatLeft(fromAccount.name) : r.beforeDeductions, amount: amountMoney });
      for (const { c, i } of [...insideBefore, ...insideAfter, ...onTop]) lines.push(chargeLine(c, i));
      return lines;
    }
    if (amountMoney) lines.push({ key: 'main', label: form.kind === 'income' ? r.beforeDeductions : fromAccount ? r.whatLeft(fromAccount.name) : r.beforeDeductions, amount: amountMoney });
    for (const { c, i } of insideBefore) lines.push(chargeLine(c, i));
    const res = preview.result;
    if (converts && res?.afterInside && res.rate) {
      lines.push({
        key: 'conv',
        label: parts(r.convertedAt(<MoneyInline value={res.afterInside} currency={mainCurrency} />, `1 ${mainCurrency} = ${trimRate(res.rate)} ${receivingCurrency}`)),
      });
    }
    for (const { c, i } of insideAfter) lines.push(chargeLine(c, i));
    if (res?.arrives && receivingName) {
      lines.push({ key: 'arrives', label: r.arrivesIn(receivingName), amount: <MoneyInline value={res.arrives} currency={receivingCurrency} />, highlight: true });
    }
    for (const { c, i } of onTop) lines.push(chargeLine(c, i));
    return lines;
  }

  const onTopOnReceiving = form.charges.filter((c) => c.deduction === 'charged_separately' && c.accountId === (form.kind === 'transfer' ? toAccount?.id : fromAccount?.id));

  // ── Rows ──
  const accountChip = (a: { icon: string; color: string }) => (
    <View style={[styles.rowIcon, { backgroundColor: swatch(a.color).bg }]}>
      <Icon name={a.icon} size={12} color={swatch(a.color).fg} />
    </View>
  );
  const personChip = (name: string) => <Initials name={name} size={24} />;
  /** A grey row icon for rows with nothing picked yet (Tag, Status, Expected back). */
  const plainChip = (icon: string, color: string) => (
    <View style={[styles.rowIcon, { backgroundColor: colors.filled }]}>
      <Icon name={icon} size={12} color={color} />
    </View>
  );
  const sideValue = (side: typeof form.from) => {
    if (!side) return undefined;
    if (side.type === 'account') return ref.accounts.get(side.id)?.name;
    return ref.people.get(side.id)?.name;
  };
  const category = form.categoryId ? ref.categories.get(form.categoryId) : null;
  const ledger = form.ledgerId ? ref.ledgers.get(form.ledgerId) : null;

  const hasRow = fromAccount ? (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={[styles.rowLabelSmall, { color: colors.inkMuted }]}>{s.has}</Text>
      <Money value={ref.balances.get(fromAccount.id) ?? '0'} currency={fromAccount.currency} style={styles.has} />
    </View>
  ) : null;

  const warningNote =
    warning?.level === 'balance' && fromAccount ? (
      <RowNote tone="danger" icon="bolt">
        {parts(s.warnBalance(<MoneyInline size={11} value={warning.overBy} currency={fromAccount.currency} tone="expense" />, fromAccount.name))}
        {parts(
          s.warnBalanceAfter(
            <MoneyInline size={11} value={warning.after} currency={fromAccount.currency} tone="expense" />,
            dec(warning.setAsideUsedUp).gt(0) ? <MoneyInline size={11} value={warning.setAsideUsedUp} currency={fromAccount.currency} /> : null,
          ),
        )}
      </RowNote>
    ) : warning?.level === 'savings' && fromAccount ? (
      <RowNote tone="warning" icon="bolt">
        {parts(
          s.warnSavings(
            <MoneyInline size={11} value={warning.usesSavings} currency={fromAccount.currency} />,
            <MoneyInline size={11} value={warning.usable} currency={fromAccount.currency} />,
            <MoneyInline size={11} value={warning.setAside} currency={fromAccount.currency} />,
          ),
        )}
        {warning.firstGoal ? parts(s.warnSavingsGoal(warning.firstGoal.name, <MoneyInline size={11} value={warning.firstGoal.amount} currency={fromAccount.currency} />)) : null}
      </RowNote>
    ) : null;

  // ── Split ──
  const splitIPaidTotal = fromAccount && preview.result ? preview.result.accountAmount : null;
  const yourShare = form.split?.shares.find((sh) => sh.personId === null);
  const splitNames = form.split?.shares
    .filter((sh) => sh.personId !== null)
    .map((sh) => ref.people.get(sh.personId!)?.name ?? '')
    .join(', ');
  const splitCurrency = form.from?.type === 'person' ? mainCurrency : (fromAccount?.currency ?? mainCurrency);
  // No split yet: an outlined button (board "Add — Expense"); once set, a row with the shares.
  const splitRow = !form.split ? (
    <Button kind="secondary" icon="split" label={strings.split.button} onPress={() => setSheet('split')} style={styles.splitButton} />
  ) : (
    <FormRow
      dashed={!form.split}
      label={strings.split.row}
      value={
        form.split && yourShare && splitNames
          ? parts(strings.split.rowValue(splitNames, <MoneyInline size={13} value={yourShare.amount} currency={splitCurrency} />))
          : undefined
      }
      placeholder={strings.split.rowPlaceholder}
      onPress={() => setSheet('split')}
    />
  );

  const rows = (() => {
    if (isSavings) {
      const held = goal?.held ?? '0';
      const rest = goal ? stillToGo(goal.target, held, amount ?? '0') : null;
      const toFinish = goal ? stillToGo(goal.target, held) : null;
      return (
        <>
          <Text style={[styles.intro, { color: colors.inkSecondary }]}>{s.savingsIntro(goal?.currency ?? mainCurrency)}</Text>
          <FormRow label={s.goal} value={goal ? `${goal.title} · ${goal.currency}` : undefined} placeholder={goals.length ? s.pickGoal : s.noGoals} onPress={goals.length ? () => setSheet('goal') : undefined} />
          {goal ? (
            <FormRow
              label={s.fromAccountCurrency(goal.currency)}
              value={goalAccount?.name}
              placeholder={s.pick}
              onPress={() => setSheet('goalAccount')}
              icon={goalAccount ? accountChip(goalAccount) : undefined}
              trailing={
                goalAccount && goalFree !== null ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.rowLabelSmall, { color: colors.inkMuted }]}>{s.freeHere}</Text>
                    <Money value={goalFree} currency={goalAccount.currency} style={styles.has} />
                  </View>
                ) : undefined
              }
            />
          ) : null}
          {goal ? (
            <View style={styles.goalLine}>
              <Text style={[styles.goalText, { color: colors.inkSecondary }]}>{s.setAsideNow}</Text>
              <MoneyInline value={held} currency={goal.currency} />
            </View>
          ) : null}
          {goal && rest !== null && toFinish !== null ? (
            dec(rest).isZero() && amount ? (
              <RowNote>{s.goalReached}</RowNote>
            ) : (
              <RowNote>
                {parts(s.stillToGo(<MoneyInline size={11} value={rest} currency={goal.currency} />))}
                <Text style={{ color: colors.accent, fontFamily: fonts.sansBold }} onPress={() => set({ expression: toFinish })}>
                  {parts(s.addToFinish(<MoneyInline size={11} value={toFinish} currency={goal.currency} />))}
                </Text>
              </RowNote>
            )
          ) : null}
          {goal && savingsOver ? (
            <RowNote tone="danger" icon="bolt">
              {parts(
                s.goalOverBalance(
                  <MoneyInline size={11} value={amount ?? '0'} currency={goal.currency} />,
                  goal.title,
                  goal.currency,
                  <MoneyInline size={11} value={savingsOver} currency={goal.currency} tone="expense" />,
                ),
              )}
            </RowNote>
          ) : null}
        </>
      );
    }


    const tagRow = (
      <FormRow
        dashed={!form.referencePersonId}
        label={s.tag}
        icon={form.referencePersonId ? personChip(ref.people.get(form.referencePersonId)?.name ?? '?') : plainChip('user', colors.inkMuted)}
        value={form.referencePersonId ? ref.people.get(form.referencePersonId)?.name : undefined}
        placeholder={s.tagPlaceholder[form.kind as 'expense' | 'income' | 'transfer']}
        onPress={() => setSheet('tag')}
      />
    );
    const statusRows = (
      <>
        <TourTarget id="add.status">
          <FormRow label={s.status} icon={plainChip('clock', colors.inkSecondary)} value={s.statuses[form.status]} onPress={() => setSheet('status')} />
        </TourTarget>
        {form.status === 'pending' ? (
          <FormRow
            label={s.expected}
            value={form.expectedDate ? formatLongDate(form.expectedDate) : undefined}
            placeholder={s.noExpected}
            onPress={() => pickDate(form.expectedDate ?? today, (d) => set({ expectedDate: d }))}
          />
        ) : null}
      </>
    );
    const budgetNote =
      budget && fromAccount ? (
        <RowNote tone="warning" icon="chart">
          {parts(
            budget.alreadyOver
              ? strings.budgets.warnAlreadyOver(category?.name ?? '', <MoneyInline size={11} value={budget.cap} currency={fromAccount.currency} />, <MoneyInline size={11} value={budget.spent} currency={fromAccount.currency} />)
              : strings.budgets.warnOver(category?.name ?? '', <MoneyInline size={11} value={budget.cap} currency={fromAccount.currency} />, <MoneyInline size={11} value={budget.after} currency={fromAccount.currency} />),
          )}
        </RowNote>
      ) : null;
    const categoryRow = (
      <TourTarget id="add.category">
        <FormRow
          label={s.category}
          icon={category ? accountChip(category) : undefined}
          value={category?.name}
          placeholder={s.noCategory}
          onPress={() => setSheet('category')}
        />
      </TourTarget>
    );
    // Editing a transaction in a year already sent to Tax export (Spec: one-line warning, no change log).
    const exportedMonth = editId ? exportedPeriodFor(db, form.date) : null;
    const exportedNote = exportedMonth ? (
      <RowNote tone="warning" icon="document">
        {strings.taxExport.exportedWarning(exportedMonth)}
      </RowNote>
    ) : null;
    const upcomingNote =
      upcoming && upcoming.count > 0 && fromAccount ? (
        <RowNote icon="calendar">{parts(s.upcoming(upcoming.count, <MoneyInline size={11} value={upcoming.total} currency={fromAccount.currency} />, formatShortDate(upcoming.lastDate!)))}</RowNote>
      ) : null;

    if (form.kind === 'transfer') {
      return (
        <>
          <FormRow
            label={form.from?.type === 'person' ? s.fromPerson : s.from}
            icon={fromAccount ? accountChip(fromAccount) : fromPerson ? personChip(fromPerson.name) : undefined}
            value={sideValue(form.from)}
            placeholder={s.pick}
            trailing={hasRow}
            onPress={() => setSheet('from')}
          />
          {upcomingNote}
          {exportedNote}
          {warningNote}
          <FormRow
            label={form.to?.type === 'person' ? s.toPerson : s.to}
            icon={toAccount ? accountChip(toAccount) : toPerson ? personChip(toPerson.name) : undefined}
            value={sideValue(form.to)}
            placeholder={s.pick}
            onPress={() => setSheet('to')}
          />
          {toPerson && amount ? <RowNote>{s.lendHint(toPerson.name)}</RowNote> : null}
          {fromPerson ? <RowNote>{s.borrowHint(fromPerson.name)}</RowNote> : null}
          {transferPerson && personBalancesNow.length > 0 && !personBalancesNow.some(([c]) => c === mainCurrency) ? (
            <RowNote tone="warning" icon="bolt">
              {s.otherCurrencyPerson(transferPerson.name, personBalancesNow.map(([c]) => c).join(', '), mainCurrency)}{' '}
              <Text style={{ color: colors.accent, fontFamily: fonts.sansBold }} onPress={() => router.push(`/people/${transferPerson.id}/settle`)}>
                {s.settleInstead}
              </Text>
            </RowNote>
          ) : null}
          {tagRow}
          {statusRows}
        </>
      );
    }

    return (
      <>
        <FormRow
          label={form.kind === 'expense' ? (form.from?.type === 'person' ? s.paidFrom : s.account) : s.account}
          icon={fromAccount ? accountChip(fromAccount) : fromPerson ? personChip(fromPerson.name) : undefined}
          value={sideValue(form.from)}
          placeholder={s.pick}
          trailing={form.kind === 'expense' ? hasRow : undefined}
          onPress={() => setSheet('from')}
        />
        {upcomingNote}
        {exportedNote}
        {warningNote}
        {fromPerson && form.kind === 'expense' ? <RowNote>{s.paidByHint(fromPerson.name)}</RowNote> : null}
        {categoryRow}
        {form.kind === 'expense' ? budgetNote : null}
        {tagRow}
        {statusRows}
        {form.kind === 'expense' ? (
          <>
            <ToggleRow title={s.reimbursable} value={form.reimbursable} onChange={(v) => set({ reimbursable: v, expectedFromPersonId: v ? form.expectedFromPersonId : null })} />
            {form.reimbursable ? (
              <FormRow
                label={s.expectedBackFrom}
                icon={form.expectedFromPersonId ? personChip(ref.people.get(form.expectedFromPersonId)?.name ?? '?') : plainChip('user', colors.inkSecondary)}
                value={form.expectedFromPersonId ? ref.people.get(form.expectedFromPersonId)?.name : undefined}
                placeholder={strings.common.none}
                onPress={() => setSheet('expectedBack')}
              />
            ) : null}
            {splitRow}
          </>
        ) : null}
      </>
    );
  })();

  const r = preview.result;
  // The account the charges page shows: where the money arrives (income, transfer) or leaves (expense).
  const chargesAccount = form.kind === 'transfer' ? (toAccount ?? fromAccount) : fromAccount;
  const goesUp =
    (form.kind === 'income' || (form.kind === 'transfer' && toAccount)) && r?.netAmount && receivingName ? (
      <View style={[styles.goesUp, { backgroundColor: colors.accentSoft }]}>
        <Text style={[styles.goesUpLabel, { color: colors.accent }]}>{strings.receipt.goesUpBy(receivingName)}</Text>
        <Money value={r.netAmount} currency={receivingCurrency} allowCompact={false} style={[styles.goesUpAmount, { color: colors.ink }]} />
        {onTopOnReceiving.length && r.arrives ? (
          <Text style={[styles.goesUpDetail, { color: colors.accent }]}>
            {parts(
              strings.receipt.goesUpDetail(
                <MoneyInline value={r.arrives} currency={receivingCurrency} />,
                <MoneyInline value={add(...onTopOnReceiving.map((c) => c.amount))} currency={receivingCurrency} />,
              ),
            )}
          </Text>
        ) : null}
      </View>
    ) : null;



  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Header
          title={editId ? s.editTitle : s.title}
          onBack={goBack}
          backIcon="close"
          actions={<IconButton icon="tick" filled label={strings.common.save} onPress={save} disabled={!canSave || saving} />}
        />
        {!editId ? (
          <TourTarget id="add.kinds">
          <Segmented
            options={(['expense', 'income', 'transfer', 'savings'] as const).map((k) => ({ value: k, label: s.kinds[k] }))}
            value={form.kind}
            onChange={changeKind}
            small
            tint={{ expense: colors.expense, income: colors.income, transfer: colors.accent, savings: colors.accent }}
          />
          </TourTarget>
        ) : null}
        {action.ui}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.rows} keyboardShouldPersistTaps="handled">
        {rows}
      </ScrollView>

      <TourTarget id="add.amount" style={styles.bottom}>
        {converts ? (
          <ConversionTrio
            amount={{
              label: (form.kind === 'expense' ? s.trioPaid : form.kind === 'income' ? s.trioPaidIncome : s.trioSent).toUpperCase(),
              currency: mainCurrency,
              onCurrency: form.kind === 'expense' || form.kind === 'income' ? () => setSheet('currency') : undefined,
              expression: form.expression,
              value: amount,
            }}
            rate={{
              from: mainCurrency,
              to: receivingCurrency,
              expression: form.rateText,
              value: form.rateMode === 'rate_known' ? rate : (r?.rate ?? null),
              worked: form.rateMode !== 'rate_known',
            }}
            counter={{
              label: (form.kind === 'expense' ? s.trioCharged(receivingName ?? '') : s.trioArrived(receivingName ?? '')).toUpperCase(),
              currency: receivingCurrency,
              expression: form.knownExpression,
              value: form.rateMode === 'amount_known' ? known : r ? (form.kind === 'transfer' ? (r.toAmount ?? null) : r.accountAmount) : null,
              worked: form.rateMode !== 'amount_known',
            }}
            focused={form.target === 'known' ? 'counter' : form.target}
            onFocus={(slot) => setForm((f) => focusConversion(f, slot === 'counter' ? 'known' : slot))}
            onBackspace={() => onKey('back')}
            onClear={() => onKey('clear')}
            market={market?.rate ?? null}
            onUseMarket={() => market && set({ rateMode: 'rate_known', rateText: trimRate(market.rate), target: 'rate' })}
            vsMarket={(() => {
              const pct = vsMarketPercent(r?.rate ?? null, market?.rate ?? null);
              return pct ? s.vsMarket(pct) : null;
            })()}
            footer={
              <Text onPress={() => pickDate(form.date, (d) => set({ date: d }))} style={[styles.trioDate, { color: colors.inkMuted }]} suppressHighlighting>
                {formatLongDate(form.date)}
              </Text>
            }
          />
        ) : (
          <AmountCard
            expression={formatTyped(form.expression, mainCurrency, settings.numberFormat)}
            showExpression={hasOperator(form.expression)}
            value={
              hasOperator(form.expression) && amount
                ? formatAmount(amount, mainCurrency, { numberFormat: settings.numberFormat, showCurrency: false }).text
                : formatTyped(form.expression, mainCurrency, settings.numberFormat)
            }
            currency={mainCurrency}
            onCurrency={form.kind === 'expense' || form.kind === 'income' ? () => setSheet('currency') : undefined}
            date={form.date}
            onDate={() => pickDate(form.date, (d) => set({ date: d }))}
            focused={false}
            onBackspace={() => onKey('back')}
            onClear={() => onKey('clear')}
          />
        )}
        <View style={styles.utilRow}>
          <UtilityButton icon="notes" label={s.notes} dot={!!form.notes.trim()} onPress={() => setSheet('notes')} />
          <UtilityButton icon="clip" label={attachmentCount ? s.files(attachmentCount) : s.attach} onPress={() => setSheet('attach')} />
        </View>
        {!isSavings ? (
          <View style={styles.utilRow}>
            <UtilityButton
              icon="ledger"
              label={chargesTotal ? (chargesTotal.currency ? <MoneyInline value={chargesTotal.text} currency={chargesTotal.currency} /> : `${s.charges} · ${chargesTotal.text}`) : s.charges}
              onPress={openCharges}
              dot={form.charges.length > 0}
            />
            <UtilityButton icon="layers" label={ledger?.name ?? '—'} onPress={() => setSheet('ledger')} />
          </View>
        ) : null}
        <Keypad onKey={onKey} />
      </TourTarget>
      {!editId ? <Tour id="add" steps={strings.tour.add} delay={800} /> : null}

      {/* ── Sheets ── */}
      <AccountOrPersonSheet
        visible={sheet === 'from'}
        title={form.kind === 'expense' ? s.paidFrom : form.kind === 'transfer' ? s.from : s.account}
        value={form.from}
        allowPerson={form.kind !== 'income'}
        excludeAccountId={form.kind === 'transfer' && form.to?.type === 'account' ? form.to.id : null}
        onSelect={(side) => set({ from: side, ...(form.kind === 'transfer' && side?.type === 'person' && form.to?.type === 'person' ? { to: null } : {}) })}
        onClose={() => setSheet(null)}
        onNewAccount={() => router.push('/accounts/new')}
        onNewPerson={() => router.push('/people/new')}
      />
      <AccountOrPersonSheet
        visible={sheet === 'to'}
        title={s.to}
        value={form.to}
        allowPerson={form.from?.type !== 'person'}
        excludeAccountId={form.from?.type === 'account' ? form.from.id : null}
        onSelect={(side) => set({ to: side })}
        onClose={() => setSheet(null)}
        onNewAccount={() => router.push('/accounts/new')}
        onNewPerson={() => router.push('/people/new')}
      />
      <PickerSheet
        visible={sheet === 'category'}
        title={s.category}
        searchPlaceholder="Search categories"
        sections={categorySections}
        selectedId={form.categoryId}
        onSelect={(id) => set({ categoryId: id || null })}
        clearLabel={s.noCategory}
        onClose={() => setSheet(null)}
        newLabel={`+ ${strings.categories.add}`}
        onNew={() => router.push({ pathname: '/categories/new', params: { kind: form.kind === 'income' ? 'income' : 'expense' } })}
      />
      <PickerSheet
        visible={sheet === 'tag' || sheet === 'expectedBack'}
        title={sheet === 'tag' ? s.tag : s.expectedBackFrom}
        searchPlaceholder="Search people"
        sections={[{ items: peopleItems }]}
        selectedId={sheet === 'tag' ? form.referencePersonId : form.expectedFromPersonId}
        onSelect={(id) => (sheet === 'tag' ? set({ referencePersonId: id || null }) : set({ expectedFromPersonId: id || null }))}
        clearLabel={strings.common.none}
        onClose={() => setSheet(null)}
        newLabel={`+ ${strings.people.add}`}
        onNew={() => router.push('/people/new')}
      />
      <SplitEditor
        visible={sheet === 'split'}
        initial={form.split}
        initialPayerId={form.from?.type === 'person' ? form.from.id : null}
        iPaid={{ total: splitIPaidTotal, currency: fromAccount?.currency ?? mainCurrency, accountName: fromAccount?.name ?? null }}
        someonePaid={{ total: amount, currency: mainCurrency }}
        onSave={({ split, payerId }) => {
          const from: FormState['from'] = payerId
            ? { type: 'person', id: payerId }
            : form.from?.type === 'account'
              ? form.from
              : ref.firstAccount
                ? { type: 'account', id: ref.firstAccount }
                : null;
          set({ split, from });
          setSheet(null);
        }}
        onRemove={() => {
          set({ split: null });
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'status'}
        title={s.status}
        sections={[
          {
            items: (['cleared', 'pending', 'in_transit'] as const).map((st) => ({ id: st, title: s.statuses[st], detail: s.statusDetail[st] })),
          },
        ]}
        selectedId={form.status}
        onSelect={(id) => set({ status: id as FormState['status'] })}
        onClose={() => setSheet(null)}
      />
      <PickerSheet visible={sheet === 'ledger'} title="Ledger" sections={[{ items: ledgerItems }]} selectedId={form.ledgerId} onSelect={(id) => set({ ledgerId: id })} onClose={() => setSheet(null)} />
      <PickerSheet
        visible={sheet === 'goal'}
        title={s.goal}
        sections={[{ items: goals }]}
        selectedId={form.goalId}
        onSelect={(id) => set({ goalId: id, goalAccountId: null })}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'goalAccount'}
        title={goal ? s.fromAccountCurrency(goal.currency) : s.account}
        sections={goalAccountSections}
        selectedId={form.goalAccountId}
        onSelect={(id) => set({ goalAccountId: id })}
        onClose={() => setSheet(null)}
      />
      <CurrencySheet visible={sheet === 'currency'} selected={mainCurrency} onSelect={(c) => set({ currency: c })} onClose={() => setSheet(null)} />
      <AttachSheet
        visible={sheet === 'attach'}
        saved={savedAttachments}
        picked={form.attachments.picked}
        onChange={(c) =>
          setForm((f) => ({
            ...f,
            attachments: {
              picked: [...f.attachments.picked.filter((_, i) => i !== c.removePicked), ...(c.add ?? [])],
              removeIds: c.removeSaved ? [...f.attachments.removeIds, c.removeSaved] : f.attachments.removeIds,
            },
          }))
        }
        onClose={() => setSheet(null)}
      />
      <NotesSheet visible={sheet === 'notes'} value={form.notes} onDone={(v) => set({ notes: v })} onClose={() => setSheet(null)} />
      {/* Charges: a page over the form (board "Add — Income, charges expanded", option D). ✓ keeps the charges and goes back to the form; ✕ or Back drops this visit's changes, after a warning. */}
      <Modal
        visible={sheet === 'charges'}
        animationType="slide"
        onRequestClose={cancelCharges}
        onShow={() => chargeEdit?.index === null && !chargeEdit.expression && setChargeSheet('type')}
        statusBarTranslucent
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
          <View style={styles.chargesPage}>
            <Header
              title={editId ? s.editTitle : s.title}
              onBack={cancelCharges}
              backIcon="close"
              actions={<IconButton icon="tick" filled label={strings.receipt.done} onPress={doneCharges} />}
            />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 11, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
              {chargesAccount ? <FormRow label={form.kind === 'transfer' ? s.to : s.account} icon={accountChip(chargesAccount)} value={chargesAccount.name} /> : null}
              <ReceiptCard lines={receiptLines} onAdd={startNewCharge} emptyText={strings.receipt.none} onCollapse={doneCharges} />
              {goesUp}
            </ScrollView>
          </View>
          {chargeEdit ? (
            <ChargeEditor
              edit={chargeEdit}
              typeName={chargeEdit.type === 'custom' ? (chargeEdit.label ?? strings.charge.types.custom) : strings.charge.types[chargeEdit.type]}
              insideLabel={amount && !settings.hideAmounts ? strings.charge.insideShort(formatAmount(amount, mainCurrency, { numberFormat: settings.numberFormat }).text) : strings.charge.insideAmount}
              accountName={chargeEdit.accountId ? (ref.accounts.get(chargeEdit.accountId)?.name ?? null) : null}
              rateLabel={needsRate(chargeEdit, chargeCtx) ? { from: chargeEdit.currency, to: mainCurrency } : null}
              forcedTax={isForcedTax(chargeEdit.type)}
              onType={() => setChargeSheet('type')}
              onRemove={removeCharge}
              onDeduction={(d) => setChargeEdit((e) => e && withDeduction(e, d, chargeCtx))}
              onTax={() => setChargeEdit((e) => e && { ...e, isTax: !e.isTax })}
              onAccount={() => setChargeSheet('account')}
              onCurrency={() => setChargeSheet('currency')}
              onRate={() => setChargeEdit((e) => e && { ...e, target: 'rate' })}
              onAmount={() => setChargeEdit((e) => e && { ...e, target: 'amount' })}
              onKey={(k) => setChargeEdit((e) => e && pressChargeKey(e, k))}
            />
          ) : (
            <ChargeEditorHint>{strings.charge.pickHint}</ChargeEditorHint>
          )}
        </SafeAreaView>

        <PickerSheet
          visible={chargeSheet === 'type'}
          title={strings.charge.typeTitle}
          searchPlaceholder={strings.charge.typeSearch}
          searchDetails
          sections={chargeTypeSections}
          selectedId={chargeEdit ? (chargeEdit.type === 'custom' ? `custom:${chargeEdit.label ?? ''}` : chargeEdit.type) : null}
          onSelect={(id) =>
            setChargeEdit((e) =>
              e && (id.startsWith('custom:') ? withType(e, 'custom', chargeCtx, id.slice(7)) : withType(e, id as ChargeType, chargeCtx)),
            )
          }
          onCreate={{ label: strings.charge.addType, onCreate: (name) => setChargeEdit((e) => e && withType(e, 'custom', chargeCtx, name)) }}
          onClose={() => setChargeSheet(null)}
        />
        <PickerSheet
          visible={chargeSheet === 'account'}
          title={strings.charge.paidFrom}
          sections={chargeAccountSections}
          selectedId={chargeEdit?.accountId ?? null}
          onSelect={(id) => setChargeEdit((e) => e && withAccount(e, id, chargeCtx))}
          onClose={() => setChargeSheet(null)}
        />
        <CurrencySheet
          visible={chargeSheet === 'currency'}
          selected={chargeEdit?.currency ?? mainCurrency}
          onSelect={(c) => setChargeEdit((e) => e && { ...e, currency: c, rate: null, target: 'amount' })}
          onClose={() => setChargeSheet(null)}
        />
        <BottomSheet visible={chargeSheet === 'discard'} onClose={() => setChargeSheet(null)} title={strings.charge.discardTitle}>
          <View style={{ gap: 12 }}>
            <Text style={[styles.discardBody, { color: colors.inkSecondary }]}>{strings.charge.discardBody}</Text>
            <Button kind="danger" label={strings.charge.discard} onPress={discardCharges} />
            <Button kind="secondary" label={strings.charge.keepEditing} onPress={() => setChargeSheet(null)} />
          </View>
        </BottomSheet>
      </Modal>
    </SafeAreaView>
  );
}


function NotesSheet({ visible, value, onDone, onClose }: { visible: boolean; value: string; onDone: (v: string) => void; onClose: () => void }) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState(value);
  const [shownFor, setShownFor] = useState(false);
  if (visible !== shownFor) {
    setShownFor(visible);
    if (visible) setDraft(value);
  }
  const close = () => {
    onDone(draft);
    onClose();
  };
  return (
    <BottomSheet visible={visible} onClose={close} title={strings.notesSheet.title}>
      <View style={{ gap: 8 }}>
        <TextInput
          value={draft}
          onChangeText={(t) => setDraft(t.slice(0, NOTES_MAX))}
          multiline
          autoFocus
          placeholder={strings.notesSheet.placeholder}
          placeholderTextColor={colors.inkMuted}
          style={[styles.notes, { backgroundColor: colors.filled, color: colors.ink }]}
        />
        {draft.length > NOTES_MAX - 200 ? (
          <Text style={[styles.counter, { color: colors.inkMuted }]}>{strings.notesSheet.counter(draft.length, NOTES_MAX)}</Text>
        ) : null}
        <Button label={strings.notesSheet.done} onPress={close} />
      </View>
    </BottomSheet>
  );
}


const styles = StyleSheet.create({
  top: { paddingHorizontal: 20, paddingTop: 12, gap: 9 },
  rows: { paddingHorizontal: 20, paddingTop: 9, paddingBottom: 12, gap: 9 },
  bottom: { paddingHorizontal: 20, paddingBottom: 12, gap: 8 },
  utilRow: { flexDirection: 'row', gap: 8 },
  rowIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  splitButton: { height: 40 },
  rowLabelSmall: { fontFamily: fonts.sansBold, fontSize: 9.5, letterSpacing: 0.38 },
  has: { fontFamily: fonts.monoSemiBold, fontSize: 12 },
  intro: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 2 },
  goalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  goalText: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
  discardBody: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19 },
  chargesPage: { flex: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, gap: 11 },
  goesUp: { borderRadius: 16, paddingHorizontal: 17, paddingVertical: 15 },
  goesUpLabel: { fontFamily: fonts.sansExtraBold, fontSize: 11, letterSpacing: 0.66 },
  goesUpAmount: { fontFamily: fonts.mono, fontSize: 34, marginTop: 2 },
  goesUpDetail: { fontFamily: fonts.sans, fontSize: 12, marginTop: 4 },
  converted: { fontFamily: fonts.sans, fontSize: 11.5, flexShrink: 1, textAlign: 'right' },
  convertedValue: { fontFamily: fonts.monoSemiBold, fontSize: 14 },
  notes: { borderRadius: 12, padding: 14, minHeight: 140, textAlignVertical: 'top', fontFamily: fonts.sans, fontSize: 14.5 },
  counter: { fontFamily: fonts.mono, fontSize: 11, textAlign: 'right' },
  trioDate: { fontFamily: fonts.sans, fontSize: 11 },
});
