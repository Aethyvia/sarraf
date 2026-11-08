import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Header } from '@/components/ui';
import { strings } from '@/i18n/strings';
import { fonts, useTheme } from '@/theme';

/** Analytics arrives with build layer 7 (budgets, Analytics, conversion cost). */
export default function AnalyticsScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.content}>
        <Header title={strings.analyticsTab.title} />
        <Text style={[styles.soon, { color: colors.inkSecondary }]}>{strings.analyticsTab.soon}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 16 },
  soon: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19 },
});
