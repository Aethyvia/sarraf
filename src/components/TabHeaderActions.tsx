import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/ui';
import { strings } from '@/i18n/strings';
import { setHideAmounts, useSettings } from '@/state/settings';

/**
 * The top-right buttons on every main tab: the eye (Hide amounts on or off
 * everywhere, same as the Settings switch — owner, Nov 20) and Settings.
 */
export function TabHeaderActions() {
  const { hideAmounts } = useSettings();
  return (
    <View style={styles.row}>
      <IconButton
        icon={hideAmounts ? 'eye-off' : 'eye'}
        label={hideAmounts ? strings.money.showAmounts : strings.money.hideAmounts}
        onPress={() => setHideAmounts(!hideAmounts)}
      />
      <IconButton icon="settings" label={strings.settings.title} onPress={() => router.push('/settings')} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
});
