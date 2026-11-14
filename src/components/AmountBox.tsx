import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { BackspaceButton } from '@/components/Keypad';
import { strings } from '@/i18n/strings';
import { hasOperator } from '@/lib/calc';
import { Decimal, dec, formatAmount, formatTyped } from '@/lib/money';
import { useSettings } from '@/state/settings';
import { fonts, useTheme } from '@/theme';

/**
 * The amount box every amount uses with Sarraf's keypad (Owner, Nov 12): a
 * small LABEL, the expression line while there's a sum, the currency chip
 * (▾ only where the currency can change), the amount, and ⌫ (hold to clear)
 * while it's the one being typed. Tapping it points the keypad at it.
 */
export function AmountBox({
  label,
  expression,
  value,
  currency,
  onCurrency,
  focused = true,
  onFocus,
  onBackspace,
  onClear,
  size = 'large',
  footer,
  testID,
  chipText,
}: {
  label?: ReactNode;
  /** The typed expression ("1,04,000+231.75" as typed, calc symbols). */
  expression: string;
  /** Its worked-out value (stored decimal), or null when empty/incomplete. */
  value: string | null;
  currency: string;
  onCurrency?: () => void;
  focused?: boolean;
  onFocus?: () => void;
  onBackspace?: () => void;
  onClear?: () => void;
  size?: 'large' | 'small';
  footer?: ReactNode;
  testID?: string;
  /** Shown on the chip instead of the currency (e.g. "%" for percent shares). */
  chipText?: string;
}) {
  const { colors } = useTheme();
  const { numberFormat } = useSettings();
  const sum = hasOperator(expression);
  const shown = sum && value ? formatAmount(value, currency, { numberFormat, showCurrency: false }).text : formatTyped(expression, currency, numberFormat);
  const digits = shown.replace(/[^0-9]/g, '').length;
  const big = size === 'large' ? (digits > 16 ? 18 : digits > 12 ? 21 : digits > 9 ? 24 : 27) : digits > 12 ? 16 : 19;
  return (
    <Pressable
      testID={testID}
      onPress={onFocus}
      disabled={!onFocus}
      accessibilityRole="button"
      style={[styles.box, { backgroundColor: colors.surface, borderColor: focused ? colors.accent : colors.outline }]}
    >
      {label ? (
        <Text style={[styles.label, { color: colors.inkMuted }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      {sum ? (
        <Text style={[styles.expression, { color: colors.inkMuted }]} numberOfLines={1}>
          {formatTyped(expression, currency, numberFormat)}
        </Text>
      ) : null}
      <View style={styles.row}>
        <CurrencyChip currency={chipText ?? currency} onPress={onCurrency} />
        <Text style={[styles.amount, { fontSize: big, color: shown ? colors.ink : colors.inkMuted }]} numberOfLines={1} adjustsFontSizeToFit>
          {shown || '0'}
        </Text>
        {focused && onBackspace && expression ? <BackspaceButton small onPress={onBackspace} onLongPress={onClear ?? onBackspace} /> : null}
      </View>
      {footer}
    </Pressable>
  );
}

/** The currency chip: ▾ only when it can be changed. */
export function CurrencyChip({ currency, onPress }: { currency: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={6}
      style={[styles.chip, { backgroundColor: colors.filled }]}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={onPress ? `Currency ${currency}, change` : `Currency ${currency}`}
    >
      <Text style={[styles.chipText, { color: colors.ink }]}>{currency}</Text>
      {onPress ? <Icon name="down" size={9} color={colors.inkSecondary} strokeWidth={2.4} /> : null}
    </Pressable>
  );
}

export type TrioSlot = 'amount' | 'rate' | 'counter';

export interface TrioAmount {
  label: ReactNode;
  currency: string;
  onCurrency?: () => void;
  /** What's typed (when this side is typed) … */
  expression: string;
  value: string | null;
  /** … or, when it's worked out, the result (stored decimal). */
  worked?: boolean;
}

/**
 * Money in another currency (option D, Owner Nov 12): the amount, the rate and
 * the other amount together. Tap the one you know and type it on the keypad;
 * the other of rate/counter is worked out and marked. No switch.
 */
export function ConversionTrio({
  amount,
  counter,
  rate,
  focused,
  onFocus,
  onBackspace,
  onClear,
  market,
  onUseMarket,
  vsMarket,
  footer,
  hint,
}: {
  /** The instruction at the top; defaults to "Type the number you know…". */
  hint?: string;
  amount: TrioAmount;
  counter: TrioAmount;
  /** 1 {from} = {text} {to}. `expression` while typed, `value` when worked out. */
  rate: { from: string; to: string; expression: string; value: string | null; worked: boolean };
  focused: TrioSlot | null;
  onFocus: (slot: TrioSlot) => void;
  onBackspace: () => void;
  onClear: () => void;
  market?: string | null;
  onUseMarket?: () => void;
  vsMarket?: string | null;
  footer?: ReactNode;
}) {
  const { colors } = useTheme();
  const { numberFormat } = useSettings();
  const workedTag = <Text style={[styles.worked, { color: colors.accent }]}>WORKED OUT</Text>;
  const moneySlot = (slot: 'amount' | 'counter', a: TrioAmount) => {
    const on = focused === slot;
    const shown = a.worked
      ? a.value
        ? formatAmount(a.value, a.currency, { numberFormat, showCurrency: false }).text
        : '—'
      : hasOperator(a.expression) && a.value
        ? formatAmount(a.value, a.currency, { numberFormat, showCurrency: false }).text
        : formatTyped(a.expression, a.currency, numberFormat);
    return (
      <Pressable
        onPress={() => onFocus(slot)}
        accessibilityRole="button"
        style={[styles.slot, on && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
      >
        <View style={styles.slotHead}>
          <Text style={[styles.label, { color: colors.inkMuted, flex: 1 }]} numberOfLines={1}>
            {a.label}
          </Text>
          {a.worked && a.value ? workedTag : null}
        </View>
        {!a.worked && hasOperator(a.expression) ? (
          <Text style={[styles.expression, { color: colors.inkMuted }]} numberOfLines={1}>
            {formatTyped(a.expression, a.currency, numberFormat)}
          </Text>
        ) : null}
        <View style={styles.row}>
          <CurrencyChip currency={a.currency} onPress={a.onCurrency} />
          <Text
            style={[styles.amount, { fontSize: 19, color: a.worked ? colors.inkSecondary : shown ? colors.ink : colors.inkMuted }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {shown || '0'}
          </Text>
          {on && !a.worked && a.expression ? <BackspaceButton small onPress={onBackspace} onLongPress={onClear} /> : null}
        </View>
      </Pressable>
    );
  };
  const rateOn = focused === 'rate';
  const rateShown = rate.worked ? (rate.value ? trimRateText(rate.value) : '?') : rate.expression ? formatTyped(rate.expression, 'XXX', '1,000.00') : '?';
  return (
    <View style={[styles.trio, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
      {/* The instruction (Owner, Nov 12): three numbers would otherwise read as three answers. */}
      <Text style={[styles.instruction, { color: colors.inkMuted }]}>{hint ?? strings.add.trioHint}</Text>
      {moneySlot('amount', amount)}
      <Pressable
        onPress={() => onFocus('rate')}
        accessibilityRole="button"
        accessibilityLabel={`Rate, 1 ${rate.from} = ${rateShown} ${rate.to}`}
        style={[styles.slot, styles.rateSlot, rateOn && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
      >
        <Text style={[styles.label, { color: colors.inkMuted }]}>AT</Text>
        {/* The rate reads as a field you can type into (Owner, Nov 12): a filled box with a pencil until it's being typed. */}
        <View style={[styles.rateField, !rateOn && { backgroundColor: colors.filled }]}>
          <Text style={[styles.rate, { color: rate.worked ? colors.inkSecondary : colors.ink }]} numberOfLines={1}>
            1 {rate.from} = {rateShown} {rate.to}
          </Text>
          {!rateOn ? <Icon name="edit" size={13} color={colors.accent} strokeWidth={2} /> : null}
        </View>
        {rate.worked && rate.value ? workedTag : null}
        {rateOn && !rate.worked && rate.expression ? <BackspaceButton small onPress={onBackspace} onLongPress={onClear} /> : null}
      </Pressable>
      {moneySlot('counter', counter)}
      {market || vsMarket || footer ? (
        <View style={styles.foot}>
          {footer}
          {market && onUseMarket ? (
            <Text onPress={onUseMarket} style={[styles.market, { color: colors.accent }]} accessibilityRole="button" suppressHighlighting>
              Market {trimRateText(market)} · use it
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {vsMarket ? <Text style={[styles.vs, { color: colors.inkMuted }]}>{vsMarket}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/** A rate as shown: 2 decimals from 10 up, 4 from 1 up, 6 below 1, half-to-even (same as trimRate). */
function trimRateText(rate: string): string {
  const d = dec(rate.replace('−', '-'));
  return d.toFixed(d.abs().gte(10) ? 2 : d.abs().gte(1) ? 4 : 6, Decimal.ROUND_HALF_EVEN);
}

const styles = StyleSheet.create({
  box: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1.5, gap: 2 },
  label: { fontFamily: fonts.sansBold, fontSize: 9.5, letterSpacing: 0.5 },
  expression: { fontFamily: fonts.mono, fontSize: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontFamily: fonts.sansBold, fontSize: 11 },
  amount: { fontFamily: fonts.mono, flex: 1, fontVariant: ['tabular-nums'] },
  trio: { borderRadius: 14, borderWidth: 1, padding: 5, gap: 2 },
  slot: { borderRadius: 10, borderWidth: 1.5, borderColor: 'transparent', paddingHorizontal: 9, paddingVertical: 3, gap: 0 },
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rateSlot: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rateField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  rate: { fontFamily: fonts.mono, fontSize: 13.5, flex: 1 },
  instruction: { fontFamily: fonts.sans, fontSize: 11, paddingHorizontal: 9, paddingTop: 2 },
  worked: { fontFamily: fonts.sansBold, fontSize: 8.5, letterSpacing: 0.5 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingTop: 2, paddingBottom: 3 },
  market: { fontFamily: fonts.sansBold, fontSize: 11, textDecorationLine: 'underline' },
  vs: { fontFamily: fonts.sans, fontSize: 11 },
});
