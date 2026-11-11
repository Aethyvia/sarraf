import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { BackspaceButton } from '@/components/Keypad';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { Segmented } from '@/components/ui';
import type { ChargeDraft } from '@/data/transactions';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { Decimal, dec } from '@/lib/money';
import { fonts, radius, useTheme } from '@/theme';

/** A compact filled row that opens a sheet: small icon, LABEL above value, optional trailing. */
export function FormRow({
  icon,
  iconColor,
  label,
  value,
  placeholder,
  trailing,
  onPress,
  dashed,
  locked,
}: {
  icon?: ReactNode;
  iconColor?: string;
  label: string;
  value?: ReactNode;
  placeholder?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  dashed?: boolean;
  locked?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress || locked}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        dashed ? { backgroundColor: colors.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border } : { backgroundColor: colors.filled },
        pressed && { opacity: 0.8 },
        locked && { opacity: 0.65 },
      ]}
    >
      {icon ?? null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: iconColor ?? colors.inkMuted }]}>{label.toUpperCase()}</Text>
        {value ? (
          typeof value === 'string' || Array.isArray(value) ? (
            <Text style={[styles.rowValue, { color: colors.ink }]} numberOfLines={1}>
              {value}
            </Text>
          ) : (
            value
          )
        ) : (
          <Text style={[styles.rowPlaceholder, { color: colors.inkMuted }]} numberOfLines={1}>{placeholder}</Text>
        )}
      </View>
      {trailing}
      <Icon name={locked ? 'lock' : 'down'} size={12} color={colors.inkMuted} strokeWidth={2.2} />
    </Pressable>
  );
}

/** A one-line note under a row: neutral, amber (dips into savings) or red (more than the account has). */
export function RowNote({ tone = 'neutral', icon, children }: { tone?: 'neutral' | 'warning' | 'danger'; icon?: string; children: ReactNode }) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? colors.expense : tone === 'warning' ? colors.warning : colors.inkSecondary;
  return (
    <View style={styles.note}>
      {icon ? <Icon name={icon} size={11} color={color} strokeWidth={2} /> : null}
      <Text style={[styles.noteText, { color }]}>{children}</Text>
    </View>
  );
}

/**
 * The amount card: the expression line, the currency chip, the amount (font
 * steps down as it gets long), the date, and — when it converts — what was
 * charged or received in the account's currency.
 */
export function AmountCard({
  expression,
  showExpression,
  value,
  currency,
  onCurrency,
  date,
  onDate,
  converted,
  focused,
  onBackspace,
  onClear,
}: {
  expression: string;
  showExpression: boolean;
  /** The amount shown big: the typed number, or its result. */
  value: string;
  currency: string;
  onCurrency?: () => void;
  date: string;
  onDate: () => void;
  converted?: ReactNode;
  focused: boolean;
  /** Deletes the last typed character; holding it clears the amount. */
  onBackspace?: () => void;
  onClear?: () => void;
}) {
  const { colors } = useTheme();
  const digits = value.replace(/[^0-9]/g, '').length;
  const size = digits > 16 ? 20 : digits > 12 ? 24 : digits > 9 ? 28 : 32;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: focused ? colors.accent : 'transparent' }]}>
      {showExpression ? (
        <Text style={[styles.expression, { color: colors.inkMuted }]} numberOfLines={1}>
          {expression}
        </Text>
      ) : null}
      <View style={styles.amountRow}>
        <Pressable onPress={onCurrency} disabled={!onCurrency} style={[styles.currency, { backgroundColor: colors.filled }]} accessibilityRole="button" accessibilityLabel={`Currency ${currency}`}>
          <Text style={[styles.currencyText, { color: colors.ink }]}>{currency}</Text>
          {onCurrency ? <Icon name="down" size={9} color={colors.inkSecondary} strokeWidth={2.4} /> : null}
        </Pressable>
        <Text style={[styles.amount, { fontSize: size, color: value ? colors.ink : colors.inkMuted }]} numberOfLines={2} adjustsFontSizeToFit>
          {value || '0'}
        </Text>
        {onBackspace && value ? <BackspaceButton onPress={onBackspace} onLongPress={onClear ?? onBackspace} /> : null}
      </View>
      <View style={[styles.cardFoot, converted ? { borderTopWidth: 1, borderTopColor: colors.filled, paddingTop: 8 } : null]}>
        <Pressable onPress={onDate} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.date, { color: colors.inkMuted }]}>{formatLongDate(date)}</Text>
        </Pressable>
        {converted}
      </View>
    </View>
  );
}

export function formatLongDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${strings.dates.months[m - 1]} ${d}, ${y}`;
}

/**
 * Another currency, inline (Decided): I know the rate / I know what was
 * charged (or received). Keeps the market rate line and the gap to it.
 */
export function ConversionBlock({
  mode,
  onMode,
  knownLabel,
  rateText,
  from,
  to,
  onRate,
  market,
  onUseMarket,
  vsMarket,
  derivedRate,
}: {
  mode: 'rate_known' | 'amount_known';
  onMode: (m: 'rate_known' | 'amount_known') => void;
  knownLabel: string;
  rateText: string;
  from: string;
  to: string;
  onRate: () => void;
  market: string | null;
  onUseMarket: () => void;
  vsMarket: string | null;
  derivedRate: string | null;
}) {
  const { colors } = useTheme();
  const s = strings.add;
  const shownRate = mode === 'rate_known' ? rateText : derivedRate;
  return (
    <View style={[styles.conv, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <Segmented
        options={[
          { value: 'rate_known', label: s.iKnowRate },
          { value: 'amount_known', label: knownLabel },
        ]}
        value={mode}
        onChange={onMode}
      />
      <Pressable onPress={mode === 'rate_known' ? onRate : undefined} style={styles.convRow} accessibilityRole="button">
        <Text style={[styles.rowLabel, { color: colors.inkMuted }]}>{s.rate.toUpperCase()}</Text>
        <Text style={[styles.rate, { color: shownRate ? colors.ink : colors.inkMuted }]}>
          1 {from} = {shownRate ? trimRate(shownRate) : '?'} {to}
        </Text>
      </Pressable>
      <View style={styles.convRow}>
        {market ? (
          <Pressable onPress={onUseMarket} hitSlop={6}>
            <Text style={[styles.small, { color: colors.inkMuted }]}>
              {parts(s.marketTap(<Text style={[styles.marketRate, { color: colors.accent }]}>{trimRate(market)}</Text>))}
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.small, { color: colors.inkMuted }]}>{s.noMarket}</Text>
        )}
        {vsMarket ? <Text style={[styles.small, { color: colors.inkSecondary }]}>{s.vsMarket(vsMarket)}</Text> : null}
      </View>
    </View>
  );
}

/**
 * A rate as shown (and as "tap to use" fills in): 2 decimals from 10 up
 * ("278.10"), 4 from 1 up, 6 below 1 ("0.003596"), half-to-even.
 */
export function trimRate(rate: string): string {
  const d = dec(rate);
  const places = d.gte(10) ? 2 : d.gte(1) ? 4 : 6;
  return d.toFixed(places, Decimal.ROUND_HALF_EVEN);
}

export interface ReceiptLine {
  key: string;
  label: ReactNode;
  amount?: ReactNode;
  highlight?: boolean;
  onPress?: () => void;
  /** The charge open in the editor below (outlined). */
  editing?: boolean;
}

/** Charges as a receipt, top to bottom: each charge on the line where it happened. */
export function ReceiptCard({ lines, onAdd, emptyText, onCollapse }: { lines: ReceiptLine[]; onAdd: () => void; emptyText?: string; onCollapse?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.receipt, { backgroundColor: colors.surface }]}>
      <Pressable onPress={onCollapse} disabled={!onCollapse} style={styles.receiptHead} accessibilityRole={onCollapse ? 'button' : undefined}>
        <Text style={[styles.receiptTitle, { color: colors.inkMuted }]}>{strings.receipt.title}</Text>
        {onCollapse ? <Icon name="up" size={13} color={colors.inkMuted} strokeWidth={2.2} /> : null}
      </Pressable>
      {lines.length === 0 && emptyText ? <Text style={[styles.small, { color: colors.inkMuted, paddingVertical: 8 }]}>{emptyText}</Text> : null}
      {lines.map((l, i) => (
        <Pressable
          key={l.key}
          onPress={l.onPress}
          disabled={!l.onPress}
          style={[
            styles.receiptLine,
            l.highlight ? { backgroundColor: colors.filled, borderRadius: 8, paddingHorizontal: 8, marginVertical: 4 } : i < lines.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.line } : null,
            l.editing ? { backgroundColor: colors.accentSoft, borderColor: colors.accent, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, marginVertical: 2 } : null,
          ]}
        >
          <Text style={[styles.receiptLabel, { color: l.highlight ? colors.ink : colors.inkSecondary }, l.highlight && { fontFamily: fonts.sansBold }]}>{l.label}</Text>
          {l.amount ?? null}
        </Pressable>
      ))}
      <Pressable onPress={onAdd} style={styles.addCharge} accessibilityRole="button">
        <Text style={[styles.addChargeText, { color: colors.accent }]}>{strings.receipt.addCharge}</Text>
      </Pressable>
    </View>
  );
}

/** A charge's label: its type (or custom name), with where it sits. */
export function chargeLabel(c: ChargeDraft): { name: string; where: string } {
  const s = strings.receipt;
  const name = c.type === 'custom' ? (c.label ?? strings.charge.types.custom) : strings.charge.types[c.type];
  const where = [c.isTax || c.type === 'withholding_tax' ? s.tax : null, c.deduction === 'already_deducted' ? s.inside : s.onTop].filter(Boolean).join(' · ');
  return { name, where };
}

/** One of the four buttons above the keypad. */
export function UtilityButton({ icon, label, onPress, dot, disabled }: { icon: string; label: ReactNode; onPress: () => void; dot?: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.util, { borderColor: colors.border }, (pressed || disabled) && { opacity: disabled ? 0.45 : 0.75 }]}
    >
      <Icon name={icon} size={15} color={colors.ink} strokeWidth={1.8} />
      {typeof label === 'string' ? <Text style={[styles.utilText, { color: colors.ink }]} numberOfLines={1}>{label}</Text> : label}
      {dot ? <View style={[styles.dot, { backgroundColor: colors.accent }]} /> : null}
    </Pressable>
  );
}

export function MoneyInline({
  value,
  currency,
  tone,
  size = 14,
  sign,
}: {
  value: string;
  currency: string;
  tone?: 'expense' | 'income';
  size?: number;
  sign?: 'always' | 'minus' | 'auto' | 'never';
}) {
  const { colors } = useTheme();
  return (
    <Money value={value} currency={currency} sign={sign} allowCompact={false} style={[{ fontSize: size }, tone && { color: tone === 'expense' ? colors.expense : colors.income }]} />
  );
}

export { formatShortDate };

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9, minHeight: 44 },
  rowLabel: { fontFamily: fonts.sansBold, fontSize: 9.5, letterSpacing: 0.38 },
  rowValue: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
  rowPlaceholder: { fontFamily: fonts.sansMedium, fontSize: 13 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, paddingHorizontal: 4, marginTop: -4 },
  noteText: { fontFamily: fonts.sans, fontSize: 10.5, lineHeight: 14, flex: 1 },
  card: { borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1.5 },
  expression: { fontFamily: fonts.mono, fontSize: 11.5, marginBottom: 4 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  currency: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  currencyText: { fontFamily: fonts.sansBold, fontSize: 11 },
  amount: { fontFamily: fonts.mono, flex: 1, fontVariant: ['tabular-nums'] },
  cardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, gap: 8 },
  date: { fontFamily: fonts.sans, fontSize: 11.5 },
  conv: { borderWidth: 1, borderRadius: radius.field, padding: 10, gap: 8 },
  convRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rate: { fontFamily: fonts.mono, fontSize: 14 },
  small: { fontFamily: fonts.sans, fontSize: 10.5, flexShrink: 1 },
  marketRate: { fontFamily: fonts.sansBold, textDecorationLine: 'underline' },
  receipt: { borderRadius: radius.card, paddingHorizontal: 16, paddingVertical: 14 },
  receiptHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  receiptTitle: { fontFamily: fonts.sansExtraBold, fontSize: 11, letterSpacing: 0.66 },
  receiptLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2, gap: 8 },
  receiptLabel: { fontFamily: fonts.sans, fontSize: 13, flexShrink: 1 },
  addCharge: { alignItems: 'center', paddingTop: 8 },
  addChargeText: { fontFamily: fonts.sansBold, fontSize: 12.5 },
  util: { flex: 1, height: 44, borderWidth: 1.5, borderRadius: radius.field, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  utilText: { fontFamily: fonts.sansBold, fontSize: 12, flexShrink: 1 },
  dot: { position: 'absolute', top: 8, end: 10, width: 8, height: 8, borderRadius: 4 },
});
