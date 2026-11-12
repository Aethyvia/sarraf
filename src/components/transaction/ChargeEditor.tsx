import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { BackspaceButton, Keypad } from '@/components/Keypad';
import { Segmented } from '@/components/ui';
import type { ChargeEdit } from '@/state/charge-edit';
import { strings } from '@/i18n/strings';
import { evaluate, hasOperator, type CalcKey } from '@/lib/calc';
import { fonts, radius, useTheme } from '@/theme';
import { FormRow } from './parts';

/**
 * The panel docked above the keypad on the Charges page (Decided Nov 11,
 * option D): the charge's type (a searchable list) with a bin to remove it,
 * Inside / On top and a Tax switch, the paying account or a rate when needed,
 * then the amount with its delete button, then the keypad.
 */
export function ChargeEditor({
  edit,
  typeName,
  insideLabel,
  accountName,
  rateLabel,
  forcedTax,
  onType,
  onRemove,
  onDeduction,
  onTax,
  onAccount,
  onCurrency,
  onRate,
  onAmount,
  onKey,
}: {
  edit: ChargeEdit;
  typeName: string;
  /** "Inside the $530.00". */
  insideLabel: string;
  accountName: string | null;
  /** Shown only when an inside charge is in a third currency: "1 EUR = ? USD" (from, to). */
  rateLabel: { from: string; to: string } | null;
  forcedTax: boolean;
  onType: () => void;
  onRemove: () => void;
  onDeduction: (d: ChargeEdit['deduction']) => void;
  onTax: () => void;
  onAccount: () => void;
  onCurrency: () => void;
  /** Points the keypad at the rate (Owner, Nov 12: rates use the same keypad). */
  onRate: () => void;
  /** Points the keypad back at the amount. */
  onAmount: () => void;
  onKey: (key: CalcKey) => void;
}) {
  const s = strings.charge;
  const { colors } = useTheme();
  const onTop = edit.deduction === 'charged_separately';
  const tax = forcedTax || edit.isTax;
  const shown = edit.expression || '0';
  const result = hasOperator(edit.expression) ? evaluate(edit.expression) : null;
  const rateOn = !!rateLabel && edit.target === 'rate';

  return (
    <View style={[styles.dock, { backgroundColor: colors.sheet, borderTopColor: colors.outline }]}>
      <View style={styles.line}>
        <View style={{ flex: 1 }}>
          <FormRow label={s.type} value={typeName} onPress={onType} />
        </View>
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={s.remove}
          style={({ pressed }) => [styles.bin, { backgroundColor: colors.expenseSoft }, pressed && { opacity: 0.7 }]}
        >
          <Icon name="trash" size={17} color={colors.expense} strokeWidth={1.9} />
        </Pressable>
      </View>

      <View style={styles.line}>
        <View style={{ flex: 1 }}>
          <Segmented
            small
            options={[
              { value: 'already_deducted', label: insideLabel },
              { value: 'charged_separately', label: s.onTopShort },
            ]}
            value={edit.deduction}
            onChange={onDeduction}
          />
        </View>
        <Pressable
          onPress={onTax}
          disabled={forcedTax}
          accessibilityRole="switch"
          accessibilityState={{ checked: tax, disabled: forcedTax }}
          accessibilityLabel={s.isTax}
          style={[styles.tax, { borderColor: tax ? colors.accent : colors.border, backgroundColor: tax ? colors.accentSoft : 'transparent' }]}
        >
          {tax ? <Icon name="tick" size={11} color={colors.accent} strokeWidth={3} /> : null}
          <Text style={[styles.taxText, { color: tax ? colors.accent : colors.inkSecondary }]}>{s.taxShort}</Text>
        </Pressable>
      </View>

      {onTop ? <FormRow label={s.paidFrom} value={accountName ?? undefined} placeholder={strings.add.pick} onPress={onAccount} /> : null}
      {rateLabel ? (
        <Pressable
          onPress={onRate}
          accessibilityRole="button"
          accessibilityLabel={`Rate, 1 ${rateLabel.from} = ${edit.rate || '?'} ${rateLabel.to}`}
          style={[styles.rateRow, { backgroundColor: rateOn ? colors.accentSoft : colors.filled, borderColor: rateOn ? colors.accent : 'transparent' }]}
        >
          <Text style={[styles.rateLabel, { color: colors.inkMuted }]}>AT</Text>
          <Text style={[styles.rateText, { color: edit.rate ? colors.ink : colors.inkMuted }]} numberOfLines={1}>
            1 {rateLabel.from} = {edit.rate || '?'} {rateLabel.to}
          </Text>
          {rateOn ? null : <Icon name="edit" size={13} color={colors.accent} strokeWidth={2} />}
        </Pressable>
      ) : null}

      <Pressable
        onPress={onAmount}
        accessibilityRole="button"
        style={[styles.amountCard, { backgroundColor: colors.surface, borderColor: rateLabel && !rateOn ? colors.accent : 'transparent' }]}
      >
        <Pressable
          onPress={onCurrency}
          disabled={onTop}
          accessibilityRole="button"
          accessibilityLabel={s.currency}
          style={[styles.cur, { backgroundColor: colors.filled }]}
        >
          <Text style={[styles.curText, { color: colors.ink }]}>{edit.currency}</Text>
          {!onTop ? <Icon name="down" size={9} color={colors.inkSecondary} strokeWidth={2.4} /> : null}
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          {result ? <Text style={[styles.expr, { color: colors.inkMuted }]}>= {result}</Text> : null}
          <Text style={[styles.amount, { color: edit.expression ? colors.ink : colors.inkMuted }]} numberOfLines={1} adjustsFontSizeToFit>
            {shown}
          </Text>
        </View>
        <BackspaceButton onPress={() => onKey('back')} onLongPress={() => onKey('clear')} />
      </Pressable>

      <Keypad onKey={onKey} />
    </View>
  );
}

/** When no charge is open: what to do next. */
export function ChargeEditorHint({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.dock, { backgroundColor: colors.sheet, borderTopColor: colors.outline }]}>
      <Text style={[styles.hint, { color: colors.inkMuted }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, gap: 8 },
  line: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  bin: { width: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tax: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 12 },
  taxText: { fontFamily: fonts.sansBold, fontSize: 11.5 },
  amountCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1.5 },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 11, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 9 },
  rateLabel: { fontFamily: fonts.sansBold, fontSize: 9.5, letterSpacing: 0.4 },
  rateText: { flex: 1, fontFamily: fonts.mono, fontSize: 14 },
  cur: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  curText: { fontFamily: fonts.sansBold, fontSize: 11 },
  expr: { fontFamily: fonts.mono, fontSize: 11.5 },
  amount: { fontFamily: fonts.mono, fontSize: 26 },
  hint: { fontFamily: fonts.sans, fontSize: 12.5, textAlign: 'center', paddingVertical: 10 },
});
