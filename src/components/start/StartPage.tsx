import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { IconButton } from '@/components/ui';
import { ProgressBar } from '@/components/ProgressBar';
import { strings } from '@/i18n/strings';
import { fonts, radius, useTheme } from '@/theme';

/** One first-run screen: optional back and step dots, a hero icon, title, body, content, and buttons at the bottom. */
export function StartPage({
  onBack,
  step,
  icon,
  iconTone = 'accent',
  title,
  body,
  children,
  footer,
  centered,
}: {
  onBack?: () => void;
  /** 1–4 during setup. */
  step?: number;
  icon?: string;
  iconTone?: 'accent' | 'neutral' | 'warning';
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  centered?: boolean;
}) {
  const { colors } = useTheme();
  const tone = {
    accent: { bg: colors.accentSoft, fg: colors.accent },
    neutral: { bg: colors.filled, fg: colors.inkSecondary },
    warning: { bg: colors.warningSoft, fg: colors.warning },
  }[iconTone];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {onBack || step ? (
          <View style={styles.top}>
            {onBack ? <IconButton icon="back" label="Back" onPress={onBack} /> : <View style={{ width: 44 }} />}
            <View style={{ flex: 1 }}>{step ? <StepDots step={step} /> : null}</View>
            <View style={{ width: 44 }} />
          </View>
        ) : null}
        <View style={[styles.main, centered && styles.centered]}>
          {icon ? (
            <View style={[styles.hero, { backgroundColor: tone.bg }, centered && { alignSelf: 'center' }]}>
              <Icon name={icon} size={28} color={tone.fg} strokeWidth={1.8} />
            </View>
          ) : null}
          <View style={{ gap: 6 }}>
            <Text style={[styles.title, { color: colors.ink }, centered && { textAlign: 'center' }]}>{title}</Text>
            {body ? <Text style={[styles.body, { color: colors.inkSecondary }, centered && { textAlign: 'center' }]}>{body}</Text> : null}
          </View>
          {children}
        </View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Setup's progress (owner, Nov 12): a bar that fills step by step, with "Step n of 4". */
export function StepDots({ step, of = 4 }: { step: number; of?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }} accessibilityLabel={strings.start.stepOf(step, of)}>
      <ProgressBar value={step / of} />
      <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 11.5, color: colors.inkMuted, textAlign: 'center' }}>{strings.start.stepOf(step, of)}</Text>
    </View>
  );
}

/** A soft coloured note with an icon (teal = good to know, amber = careful, red = problem). */
export function Note({ tone, icon, children }: { tone: 'teal' | 'amber' | 'red'; icon?: string; children: ReactNode }) {
  const { colors } = useTheme();
  const look = {
    teal: { bg: colors.accentSoft, fg: colors.accent, text: colors.ink },
    amber: { bg: colors.warningSoft, fg: colors.warning, text: colors.ink },
    red: { bg: colors.expenseSoft, fg: colors.expense, text: colors.expense },
  }[tone];
  return (
    <View style={[styles.note, { backgroundColor: look.bg }]}>
      {icon ? <Icon name={icon} size={15} color={look.fg} strokeWidth={2} /> : null}
      <Text style={[styles.noteText, { color: look.text }]}>{children}</Text>
    </View>
  );
}

export function Spinner({ icon }: { icon: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.spinner}>
      <ActivityIndicator size={84} color={colors.accent} style={StyleSheet.absoluteFill} />
      <Icon name={icon} size={30} color={colors.accent} strokeWidth={1.8} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  main: { gap: 16 },
  centered: { flexGrow: 1, justifyContent: 'center', alignItems: 'stretch' },
  hero: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.serif, fontSize: 25, lineHeight: 30 },
  body: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20 },
  footer: { marginTop: 'auto', gap: 10, paddingTop: 12 },
  dots: { flexDirection: 'row', gap: 5, justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 999 },
  dotOn: { width: 18, borderRadius: 4 },
  note: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', borderRadius: radius.field, paddingHorizontal: 12, paddingVertical: 10 },
  noteText: { flex: 1, fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  spinner: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
});
