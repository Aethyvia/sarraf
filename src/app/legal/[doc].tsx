import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Header, Screen } from '@/components/ui';
import legal from '@/legal/legal.json';
import { goBack } from '@/state/nav';
import { fonts, useTheme } from '@/theme';

/** Terms of Use and Privacy Policy, from the same text as docs/legal (scripts/export-legal.mjs). */
export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const { colors } = useTheme();
  const d = doc === 'terms' ? legal.terms : legal.privacy;
  return (
    <Screen>
      <Header title={d.title} onBack={goBack} />
      <Text style={[styles.meta, { color: colors.inkMuted }]}>Last updated: {legal.updated}</Text>
      <Text style={[styles.body, { color: colors.ink }]}>{d.intro}</Text>
      {d.sections.map((s) => (
        <View key={s.heading} style={{ gap: 6 }}>
          <Text style={[styles.heading, { color: colors.ink }]}>{s.heading}</Text>
          {s.paragraphs.map((p) => (
            <Text key={p.slice(0, 40)} style={[styles.body, { color: colors.inkSecondary }]}>
              {p}
            </Text>
          ))}
        </View>
      ))}
      <View style={{ height: 24 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { fontFamily: fonts.sans, fontSize: 12, paddingHorizontal: 4 },
  heading: { fontFamily: fonts.sansBold, fontSize: 15, paddingHorizontal: 4, paddingTop: 8 },
  body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, paddingHorizontal: 4 },
});
