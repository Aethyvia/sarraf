/**
 * The component language from the "Style guide" board: rectangular 44dp buttons,
 * filled borderless inputs, bottom sheets instead of dialogs and dropdowns.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { BUTTON_HEIGHT, fonts, radius, useTheme } from '@/theme';

// ── Layout ──────────────────────────────────────────────────────────────────

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/** Screen header: a round back (or close) button, a serif title, and optional round actions. */
export function Header({
  title,
  subtitle,
  onBack,
  backIcon = 'back',
  actions,
  size,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backIcon?: 'back' | 'close';
  actions?: ReactNode;
  /** Title size. The boards: forms (✕) 18, lists 22, tab pages 24; detail pages pass 20. */
  size?: number;
}) {
  const titleSize = size ?? (!onBack ? 24 : backIcon === 'close' ? 18 : 22);
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.header}>
        {onBack && <IconButton icon={backIcon} onPress={onBack} label={backIcon === 'back' ? 'Back' : 'Close'} />}
        <Text style={[styles.title, { color: colors.ink, fontSize: titleSize }]} numberOfLines={1}>
          {title}
        </Text>
        {actions}
      </View>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.inkMuted, paddingStart: onBack ? 56 : 0 }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={style}>
      <Text style={[styles.sectionLabel, { color: colors.inkMuted }]}>{children}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors, scheme } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface },
        scheme === 'light' && styles.cardShadow,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.hint, { color: colors.inkMuted }]}>{children}</Text>;
}

// ── Buttons ─────────────────────────────────────────────────────────────────

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'dashed';

/** Every button is 44dp tall with a 12dp radius; only the width varies. */
export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  style,
  icon,
}: {
  /** Text, or text with an amount inside (see parts()). */
  label: ReactNode;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** An icon before the label. */
  icon?: string;
}) {
  const { colors } = useTheme();
  const look: Record<ButtonKind, { box: ViewStyle; text: string }> = {
    primary: { box: { backgroundColor: colors.accent }, text: colors.onAccent },
    secondary: { box: { borderWidth: 1.5, borderColor: colors.border }, text: colors.ink },
    danger: { box: { borderWidth: 1.5, borderColor: colors.expense + '33' }, text: colors.expense },
    dashed: { box: { borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed' }, text: colors.inkSecondary },
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        look[kind].box,
        (disabled || pressed) && { opacity: disabled ? 0.45 : 0.85 },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={look[kind].text} strokeWidth={2.4} /> : null}
      <Text style={[styles.buttonText, { color: look[kind].text }]}>{label}</Text>
    </Pressable>
  );
}

/** A text-only action, no chrome. */
export function LinkButton({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.link} hitSlop={8}>
      <Text style={[styles.buttonText, { color: danger ? colors.expense : colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

/** A 44dp round icon button. `filled` uses the accent (e.g. Save ✓, Add +). */
export function IconButton({
  icon,
  onPress,
  label,
  filled,
  disabled,
}: {
  icon: string;
  onPress: () => void;
  label: string;
  filled?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: filled ? colors.accent : colors.filled },
        (disabled || pressed) && { opacity: disabled ? 0.45 : 0.8 },
      ]}
    >
      <Icon name={icon} size={17} color={filled ? colors.onAccent : colors.ink} strokeWidth={filled ? 2.4 : 2} />
    </Pressable>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

/** A filled, borderless field with its label above. */
export function Field({
  label,
  optional,
  ...input
}: { label: string; optional?: boolean } & TextInputProps) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: colors.inkMuted }]}>
        {label.toUpperCase()}
        {optional ? <Text style={{ fontFamily: fonts.sansMedium }}> (optional)</Text> : null}
      </Text>
      <TextInput
        placeholderTextColor={colors.inkMuted}
        {...input}
        style={[styles.input, { backgroundColor: colors.filled, color: colors.ink }, input.multiline && { minHeight: 72, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

/** A filled row that opens a bottom sheet (never an inline dropdown). */
export function SelectorRow({
  label,
  value,
  onPress,
  locked,
  leading,
  chevron = 'down',
  detail,
}: {
  label?: string;
  /** Text, or text with an amount inside (see parts()). */
  value: ReactNode;
  onPress?: () => void;
  locked?: boolean;
  leading?: ReactNode;
  chevron?: 'down' | 'forward';
  /** A muted second line under the value (e.g. "Teal · bank icon"). */
  detail?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={locked || !onPress}
      accessibilityRole="button"
      style={[styles.selector, { backgroundColor: colors.filled }, locked && { opacity: 0.65 }]}
    >
      {leading}
      <View style={{ flex: 1 }}>
        {label ? <Text style={[styles.selectorLabel, { color: colors.inkMuted }]}>{label.toUpperCase()}</Text> : null}
        <Text style={[styles.selectorValue, { color: colors.ink }]}>{value}</Text>
        {detail ? <Text style={[styles.selectorDetail, { color: colors.inkMuted }]}>{detail}</Text> : null}
      </View>
      <Icon name={locked ? 'lock' : chevron} size={14} color={colors.inkMuted} strokeWidth={2.2} />
    </Pressable>
  );
}

export function ToggleRow({
  title,
  detail,
  value,
  onChange,
}: {
  title: string;
  detail?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.ink, fontSize: 13.5 }]}>{title}</Text>
        {detail ? <Text style={[styles.rowDetail, { color: colors.inkMuted }]}>{detail}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.filled, true: colors.accentSoft }}
        thumbColor={value ? colors.accent : colors.inkMuted}
      />
    </View>
  );
}

/**
 * Exclusive choice on a track; the selected segment lifts on a small pill
 * (the one place a pill shape survives). `tint` colours the selected segment.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  tint,
  small,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  tint?: Partial<Record<T, string>>;
  /** The compact kind selector at the top of Add transaction. */
  small?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segTrack, small && styles.segTrackSmall, { backgroundColor: colors.filled }, disabled && { opacity: 0.6 }]}>
      {options.map((o) => {
        const on = o.value === value;
        const bg = on ? (tint?.[o.value] ?? colors.surface) : 'transparent';
        return (
          <Pressable
            key={o.value}
            disabled={disabled}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled }}
            style={[styles.seg, small && styles.segSmall, { backgroundColor: bg }, on && styles.segOn]}
          >
            <Text style={[styles.segText, small && { fontSize: 10.5 }, { color: on ? (tint?.[o.value] ? '#FFFFFF' : colors.ink) : colors.inkSecondary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Rows ────────────────────────────────────────────────────────────────────

/** A round icon on its swatch's soft background. */
export function IconChip({ icon, color, size = 36 }: { icon: string; color: string; size?: number }) {
  const { swatch } = useTheme();
  const s = swatch(color);
  return (
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: s.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={Math.round(size * 0.47)} color={s.fg} />
    </View>
  );
}

/** A list row inside a Card: leading chip, title + detail, trailing content, chevron when tappable. */
export function ListRow({
  title,
  detail,
  leading,
  trailing,
  onPress,
  onLongPress,
  last,
  muted,
}: {
  title: string;
  detail?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  last?: boolean;
  muted?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [
        styles.listRow,
        !last && { borderBottomWidth: 1, borderBottomColor: colors.line },
        pressed && { backgroundColor: colors.filled },
      ]}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: muted ? colors.inkSecondary : colors.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {detail ? <Text style={[styles.rowDetail, { color: colors.inkMuted }]}>{detail}</Text> : null}
      </View>
      {trailing}
      {onPress ? <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} /> : null}
    </Pressable>
  );
}

export function Badge({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'neutral' }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: tone === 'accent' ? colors.accentSoft : colors.filled }]}>
      <Text style={[styles.badgeText, { color: tone === 'accent' ? colors.accent : colors.inkSecondary }]}>{label}</Text>
    </View>
  );
}

// ── Bottom sheet ────────────────────────────────────────────────────────────

/** Anchored to the bottom, rounded top, drag handle, scrim behind. Replaces every dialog and dropdown. */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      Animated.timing(slide, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    }
  }, [visible, slide]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} onPress={onClose} accessibilityLabel="Close" />
      {/* Keeps the sheet above the keyboard (search fields in sheets). */}
      <KeyboardAvoidingView style={styles.sheetWrap} behavior="padding" pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: colors.sheet, paddingBottom: 20 + insets.bottom },
            { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          {title ? <Text style={[styles.sheetTitle, { color: colors.ink }]}>{title}</Text> : null}
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** One choice in a sheet: title, optional detail, a tick when selected. */
export function SheetOption({
  title,
  detail,
  selected,
  onPress,
  leading,
  trailing,
  danger,
  disabled,
}: {
  title: string;
  detail?: string;
  selected?: boolean;
  onPress: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.sheetOption,
        { borderBottomColor: colors.line },
        (selected || pressed) && { backgroundColor: colors.filled },
        disabled && { opacity: 0.45 },
      ]}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: danger ? colors.expense : colors.ink, fontSize: 14 }]}>{title}</Text>
        {detail ? <Text style={[styles.rowDetail, { color: colors.inkMuted }]}>{detail}</Text> : null}
      </View>
      {trailing}
      {selected ? (
        <View style={[styles.tick, { backgroundColor: colors.accent }]}>
          <Icon name="tick" size={12} color={colors.onAccent} strokeWidth={3} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 28, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontFamily: fonts.serif, fontSize: 22 },
  subtitle: { fontFamily: fonts.sans, fontSize: 12.5 },
  sectionLabel: { fontFamily: fonts.sansExtraBold, fontSize: 12, letterSpacing: 0.84, paddingHorizontal: 2 },
  card: { borderRadius: radius.card, overflow: 'hidden' },
  cardShadow: {
    shadowColor: '#1E180C',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  hint: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 2, marginTop: -6 },
  button: {
    height: BUTTON_HEIGHT,
    borderRadius: radius.field,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  buttonText: { fontFamily: fonts.sansBold, fontSize: 13.5 },
  link: { alignSelf: 'center', paddingVertical: 8 },
  iconButton: {
    width: BUTTON_HEIGHT,
    height: BUTTON_HEIGHT,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 5 },
  input: {
    borderRadius: radius.field,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.sans,
    fontSize: 14.5,
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.field,
    paddingHorizontal: 13,
    paddingVertical: 11,
    minHeight: BUTTON_HEIGHT,
  },
  selectorLabel: { fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.4 },
  selectorValue: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  selectorDetail: { fontFamily: fonts.sans, fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  rowTitle: { fontFamily: fonts.sansSemiBold, fontSize: 15 },
  rowDetail: { fontFamily: fonts.sans, fontSize: 12, marginTop: 1 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.3 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '88%',
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: radius.pill, marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 18, paddingHorizontal: 4, paddingBottom: 8 },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 12,
    marginHorizontal: -8,
    borderRadius: radius.field,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segTrack: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.field },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  segTrackSmall: { gap: 3, borderRadius: 11 },
  segSmall: { paddingVertical: 7, borderRadius: 8 },
  segOn: { elevation: 1, shadowColor: '#1E180C', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  segText: { fontFamily: fonts.sansBold, fontSize: 12.5 },
  tick: { width: 22, height: 22, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
