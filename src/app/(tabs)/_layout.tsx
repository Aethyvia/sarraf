import { Redirect, Tabs, router, useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui';
import { strings } from '@/i18n/strings';
import { isSignedOut } from '@/data/sarraf-account';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { useSetToastInset } from '@/state/toast';
import { TourTarget } from '@/components/tour/Tour';
import { fonts, useTheme } from '@/theme';

const TABS = [
  { name: 'index', label: strings.tabs.home, icon: 'nav-home' },
  { name: 'transactions', label: strings.tabs.transactions, icon: 'nav-transactions' },
  { name: 'analytics', label: strings.tabs.analytics, icon: 'chart' },
  { name: 'savings', label: strings.tabs.savings, icon: 'piggy' },
] as const;

/** Tabs that show the Add transaction bar docked above the navigation (Spec §8). */
const WITH_ADD_BAR = new Set(['index', 'transactions']);

/** The four tabs, with the Add transaction bar docked above them on Home and Transactions. */
export default function TabsLayout() {
  // First run comes before anything else (sign in, then restore or setup).
  const { onboardingCompletedAt } = useSettings();
  const signedOut = useLive((db) => isSignedOut(db), []);
  if (!onboardingCompletedAt || signedOut) return <Redirect href="/start" />;
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation, descriptors }) => {
        const route = state.routes[state.index];
        // A screen hides the bar with tabBarStyle { display: 'none' } (Transactions while selecting).
        const style = descriptors[route.key].options.tabBarStyle as { display?: string } | undefined;
        if (style?.display === 'none') return null;
        return <TabBar active={route.name} onTab={(name) => navigation.navigate(name)} />;
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}

function TabBar({ active, onTab }: { active: string; onTab: (name: string) => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Toasts sit above the bar while the tabs are on screen.
  const [height, setHeight] = useState(0);
  const focused = useIsFocused();
  const setToastInset = useSetToastInset();
  useEffect(() => {
    setToastInset(focused ? height : 0);
    return () => setToastInset(0);
  }, [focused, height, setToastInset]);
  return (
    <View
      style={{ backgroundColor: colors.sheet, borderTopWidth: 1, borderTopColor: colors.outline }}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
    >
      {WITH_ADD_BAR.has(active) ? (
        <View style={styles.addBar}>
          <TourTarget id="home.add">
            <Button label={strings.home.addTransaction} icon="plus" onPress={() => router.push('/transaction/new')} />
          </TourTarget>
        </View>
      ) : null}
      <View style={[styles.bar, { paddingTop: WITH_ADD_BAR.has(active) ? 6 : 10, paddingBottom: 8 + insets.bottom }]}>
        {TABS.map((t) => {
          const on = t.name === active;
          return (
            <Pressable
              key={t.name}
              onPress={() => onTab(t.name)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={styles.item}
            >
              <Icon name={t.icon} size={22} color={on ? colors.accent : colors.inkMuted} strokeWidth={on ? 2.2 : 1.8} />
              <Text style={[styles.label, { color: on ? colors.accent : colors.inkMuted, fontFamily: on ? fonts.sansBold : fonts.sansSemiBold }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  addBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  bar: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 16 },
  item: { alignItems: 'center', gap: 3, minWidth: 64 },
  label: { fontSize: 11 },
});
