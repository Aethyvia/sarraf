import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { BottomSheet, Button } from '@/components/ui';
import { strings } from '@/i18n/strings';
import { fonts, useTheme } from '@/theme';
import { Note } from './StartPage';

/**
 * The one shared sign-in sheet (First run — Decided Nov 7): Google largest,
 * then GitHub and email (Apple dropped for v1). New users see "Create your
 * account"; returning users "Welcome back".
 */
export function SignInSheet({
  mode,
  onClose,
  onPick,
  busy,
}: {
  mode: 'new' | 'returning' | null;
  onClose: () => void;
  onPick: (method: 'google' | 'github' | 'email') => void;
  busy: boolean;
}) {
  const s = strings.start;
  const { colors } = useTheme();
  const row = (icon: string, label: string) => (
    <View style={styles.row}>
      <Icon name={icon} size={16} color={colors.ink} strokeWidth={1.9} />
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
    </View>
  );
  return (
    <BottomSheet visible={mode !== null} onClose={onClose}>
      <View style={{ gap: 12 }}>
        <View style={{ gap: 4 }}>
          <Text style={[styles.title, { color: colors.ink }]}>{mode === 'returning' ? s.welcomeBack : s.createTitle}</Text>
          <Text style={[styles.body, { color: colors.inkSecondary }]}>{mode === 'returning' ? s.welcomeBackBody : s.createBody}</Text>
        </View>
        <Button
          label={
            <Text>
              <Text style={{ color: '#4285F4', fontFamily: fonts.sansExtraBold }}>G </Text>
              {s.google}
            </Text>
          }
          kind="secondary"
          disabled={busy}
          style={[styles.google, { borderColor: colors.ink }]}
          onPress={() => onPick('google')}
        />
        <Button label={row('code', s.github)} kind="secondary" disabled={busy} onPress={() => onPick('github')} />
        <Button label={row('mail', s.email)} kind="secondary" disabled={busy} onPress={() => onPick('email')} />
        <Note tone="teal" icon="cloud">
          {s.driveNote}
        </Note>
        <Text style={[styles.small, { color: colors.inkMuted }]}>{s.terms}</Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.serif, fontSize: 22 },
  body: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20 },
  google: { height: 52, borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  label: { fontFamily: fonts.sansBold, fontSize: 14 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, textAlign: 'center' },
});
