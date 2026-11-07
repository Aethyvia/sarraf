import { isNull } from 'drizzle-orm';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { BottomSheet, Button, Field, LinkButton, SelectorRow, ToggleRow } from '@/components/ui';
import { CHARGE_TYPES, DEFAULT_DEDUCTION, type ChargeDraft, type ChargeType } from '@/data/transactions';
import { accounts } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { parseTypedAmount, toTypedText, type DecimalString } from '@/lib/money';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { fonts, radius, useTheme } from '@/theme';
import { CurrencySheet } from './CurrencySheet';
import { PickerSheet } from './PickerSheet';
import { useAccountSections } from './pickers';

/**
 * Add charge (Decided, councils 6–7): type, amount, and the one question —
 * is it inside the main amount, or on top of it from an account? Inside
 * charges can be in any currency (a rate is asked for when needed); on-top
 * charges are locked to their account's currency and never have a rate.
 */
export function AddChargeSheet({
  visible,
  initial,
  mainAmount,
  mainCurrency,
  receivingCurrency,
  defaultAccountId,
  previewInside,
  onSave,
  onDelete,
  onClose,
}: {
  visible: boolean;
  initial?: ChargeDraft | null;
  /** The main amount as typed, for "inside the $530.00". */
  mainAmount: DecimalString | null;
  mainCurrency: string;
  /** The currency the main amount converts into, if any (an inside charge in it needs no rate). */
  receivingCurrency: string;
  /** The receiving account (income, transfer) or the paying account (expense). */
  defaultAccountId: string | null;
  /** What the result line under "Inside" says for this charge, e.g. "Arrives in Alfalah PKR: ₨1,33,500.00". */
  previewInside?: (charge: ChargeDraft) => React.ReactNode;
  onSave: (charge: ChargeDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const settings = useSettings();
  const s = strings.charge;
  const allAccounts = useLive((db) => db.select().from(accounts).where(isNull(accounts.archivedAt)).all());
  const accountSections = useAccountSections();

  const [shownFor, setShownFor] = useState(false);
  const [type, setType] = useState<ChargeType>('transfer_fee');
  const [label, setLabel] = useState('');
  const [amountText, setAmountText] = useState('');
  const [currency, setCurrency] = useState(mainCurrency);
  const [deduction, setDeduction] = useState<ChargeDraft['deduction']>('already_deducted');
  const [accountId, setAccountId] = useState<string | null>(defaultAccountId);
  const [isTax, setIsTax] = useState(false);
  const [rateText, setRateText] = useState('');
  const [sheet, setSheet] = useState<'currency' | 'account' | null>(null);

  // Start each opening from the charge being edited, or a fresh transfer fee.
  if (visible !== shownFor) {
    setShownFor(visible);
    if (visible) {
      setType(initial?.type ?? 'transfer_fee');
      setLabel(initial?.label ?? '');
      setAmountText(toTypedText(initial?.amount, settings.numberFormat));
      setCurrency(initial?.currency ?? mainCurrency);
      setDeduction(initial?.deduction ?? DEFAULT_DEDUCTION.transfer_fee);
      setAccountId(initial?.accountId ?? defaultAccountId);
      setIsTax(initial?.isTax ?? false);
      setRateText(toTypedText(initial?.rate, settings.numberFormat));
    }
  }

  const account = allAccounts.find((a) => a.id === accountId) ?? null;
  const onTop = deduction === 'charged_separately';
  const chargeCurrency = onTop ? (account?.currency ?? currency) : currency;
  const amount = parseTypedAmount(amountText, settings.numberFormat);
  const rate = parseTypedAmount(rateText, settings.numberFormat);
  const needsRate = !onTop && chargeCurrency !== mainCurrency && chargeCurrency !== receivingCurrency;
  const forcedTax = type === 'withholding_tax';
  const valid = !!amount && Number(amount) > 0 && (!onTop || !!account) && (!needsRate || (!!rate && Number(rate) > 0)) && (type !== 'custom' || label.trim() !== '');

  const draft: ChargeDraft | null = amount
    ? {
        type,
        label: type === 'custom' ? label.trim() : null,
        amount,
        currency: chargeCurrency,
        deduction,
        rate: needsRate ? rate : null,
        rateMode: needsRate ? 'rate_known' : null,
        accountId: onTop ? accountId : null,
        isTax: forcedTax || isTax,
      }
    : null;

  const pickType = (t: ChargeType) => {
    setType(t);
    setDeduction(DEFAULT_DEDUCTION[t]);
    if (t === 'withholding_tax') setIsTax(true);
  };

  const chargeText = amount ? <Money value={amount} currency={chargeCurrency} allowCompact={false} style={styles.inlineMoney} /> : '—';
  const mainText = mainAmount ? <Money value={mainAmount} currency={mainCurrency} allowCompact={false} style={styles.inlineMoney} /> : '—';

  return (
    <BottomSheet visible={visible} onClose={onClose} title={initial ? s.editTitle : s.title}>
      <ScrollView style={{ maxHeight: 600 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: colors.inkMuted }]}>{s.type.toUpperCase()}</Text>
        <View style={styles.chips}>
          {CHARGE_TYPES.map((t) => (
            <Pressable
              key={t}
              onPress={() => pickType(t)}
              style={[styles.chip, { backgroundColor: type === t ? colors.accentSoft : colors.filled, borderColor: type === t ? colors.accent : 'transparent' }]}
            >
              <Text style={[styles.chipText, { color: type === t ? colors.accent : colors.inkSecondary }]}>{s.types[t]}</Text>
            </Pressable>
          ))}
        </View>
        {type === 'custom' ? <Field label={s.types.custom.replace('…', '')} value={label} onChangeText={setLabel} placeholder={s.customPlaceholder} /> : null}
        <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.typeHint}</Text>

        <View style={[styles.amountRow, { backgroundColor: colors.filled }]}>
          <Pressable onPress={() => !onTop && setSheet('currency')} disabled={onTop} style={[styles.currencyChip, { backgroundColor: colors.surface }]}>
            <Text style={[styles.currencyText, { color: colors.ink }]}>{chargeCurrency}</Text>
          </Pressable>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder="0.00"
            placeholderTextColor={colors.inkMuted}
            keyboardType="decimal-pad"
            style={[styles.amountInput, { color: colors.ink }]}
            accessibilityLabel={s.amount}
          />
        </View>
        {!onTop ? <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.amountHint(mainCurrency)}</Text> : null}
        {needsRate ? (
          <Field label={s.rate(chargeCurrency, mainCurrency)} value={rateText} onChangeText={setRateText} keyboardType="decimal-pad" placeholder="0.00" />
        ) : null}

        <Text style={[styles.label, { color: colors.inkMuted }]}>{s.onReceipt}</Text>
        <Text style={[styles.question, { color: colors.ink }]}>
          {parts(s.question(chargeText, mainText))}
        </Text>
        <Choice selected={!onTop} title={parts(s.insideTitle(mainText))} onPress={() => setDeduction('already_deducted')}>
          <Text style={[styles.detail, { color: colors.inkSecondary }]}>{parts(s.insideDetail(mainText))}</Text>
          {!onTop && draft && previewInside ? previewInside(draft) : null}
        </Choice>
        <Choice selected={onTop} title={s.onTopTitle} onPress={() => setDeduction('charged_separately')}>
          <Text style={[styles.detail, { color: colors.inkSecondary }]}>{s.onTopDetail}</Text>
          {onTop && account && amount ? (
            <Text style={[styles.detail, { color: colors.ink }]}>
              {parts(s.goesDownBy(account.name, <Money value={amount} currency={account.currency} allowCompact={false} style={styles.inlineMoney} />))}
            </Text>
          ) : null}
        </Choice>
        <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.notSure}</Text>

        {onTop ? <SelectorRow label={s.account} value={account?.name ?? strings.add.pick} onPress={() => setSheet('account')} /> : null}
        <ToggleRow title={s.isTax} detail={s.isTaxDetail} value={forcedTax || isTax} onChange={(v) => !forcedTax && setIsTax(v)} />

        <View style={styles.buttons}>
          <Button kind="secondary" label={s.cancel} onPress={onClose} style={{ flex: 1 }} />
          <Button
            label={initial ? s.save : s.add}
            disabled={!valid}
            style={{ flex: 1.4 }}
            onPress={() => {
              if (draft) onSave(draft);
              onClose();
            }}
          />
        </View>
        {initial && onDelete ? (
          <LinkButton
            danger
            label={strings.receipt.remove}
            onPress={() => {
              onDelete();
              onClose();
            }}
          />
        ) : null}
      </ScrollView>

      <CurrencySheet visible={sheet === 'currency'} selected={currency} onSelect={setCurrency} onClose={() => setSheet(null)} />
      <PickerSheet
        visible={sheet === 'account'}
        title={s.account}
        sections={accountSections}
        selectedId={accountId}
        onSelect={setAccountId}
        onClose={() => setSheet(null)}
      />
    </BottomSheet>
  );
}

function Choice({ selected, title, children, onPress }: { selected: boolean; title: React.ReactNode; children?: React.ReactNode; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.choice, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : 'transparent' }]}
    >
      <View style={styles.choiceHead}>
        <View style={[styles.radio, { borderColor: selected ? colors.accent : colors.border }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: colors.accent }]} /> : null}</View>
        <Text style={[styles.choiceTitle, { color: colors.ink }]}>{title}</Text>
      </View>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.sansExtraBold, fontSize: 11, letterSpacing: 0.7, paddingHorizontal: 2 },
  hint: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 2, marginTop: -4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1.5 },
  chipText: { fontFamily: fonts.sansSemiBold, fontSize: 12.5 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.field, paddingHorizontal: 10, paddingVertical: 6 },
  currencyChip: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  currencyText: { fontFamily: fonts.sansBold, fontSize: 12 },
  amountInput: { flex: 1, fontFamily: fonts.mono, fontSize: 20, paddingVertical: 6 },
  question: { fontFamily: fonts.sansSemiBold, fontSize: 14, lineHeight: 20 },
  choice: { borderWidth: 1.5, borderRadius: radius.card, padding: 12, gap: 4 },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  choiceTitle: { fontFamily: fonts.sansBold, fontSize: 14, flexShrink: 1 },
  detail: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, paddingStart: 28 },
  inlineMoney: { fontSize: 13 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
