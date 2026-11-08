import { eq } from 'drizzle-orm';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Money } from '@/components/Money';
import { db } from '@/db/client';
import { accounts, settings } from '@/db/schema';
import { SAMPLE_TODAY } from '@/db/sample';
import { resetSampleData } from '@/db/seed';
import { loadSampleClock, setSampleClock } from '@/dev/sample-clock';
import { NUMBER_FORMATS } from '@/lib/money';
import { useSettings } from '@/state/settings';
import { BUTTON_HEIGHT, fonts, radius, useTheme } from '@/theme';

/**
 * Developer preview (dev builds only, from Settings): money formatting, display
 * toggles, the sample clock and sample-data reset.
 */
const EXAMPLES: { value: string; currency: string; sign?: 'always' }[] = [
  { value: '104231.75', currency: 'PKR' },
  { value: '1250', currency: 'USD' },
  { value: '1200', currency: 'AED' },
  { value: '-4721.17', currency: 'PKR' },
  { value: '1650', currency: 'USD', sign: 'always' },
  { value: '125480231.75', currency: 'PKR' },
  { value: '-12450521170', currency: 'PKR' },
  { value: '1250340000', currency: 'USD', sign: 'always' },
  { value: '4560000000000000', currency: 'USD' },
  { value: '1234567.8', currency: 'EUR' },
  { value: '5000', currency: 'JPY' },
  { value: '1.5', currency: 'KWD' },
];

export default function DevPreview() {
  const s = useSettings();
  const { colors, swatch } = useTheme();
  const { data: accountRows } = useLiveQuery(db.select().from(accounts).orderBy(accounts.rank));

  // Drizzle queries are lazy: they only run when awaited.
  const update = async (values: Partial<typeof settings.$inferInsert>) => {
    await db.update(settings).set(values).where(eq(settings.id, 1));
  };
  const [pinned, setPinned] = useState(loadSampleClock);
  const nextFormat = NUMBER_FORMATS[(NUMBER_FORMATS.indexOf(s.numberFormat) + 1) % NUMBER_FORMATS.length];
  const nextTheme = ({ system: 'light', light: 'dark', dark: 'system' } as const)[s.theme];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.ink }]}>Sarraf · dev</Text>
        <Text style={[styles.sub, { color: colors.inkMuted }]}>
          Developer preview. Tap a short amount for the exact one.
        </Text>

        <View style={styles.toggles}>
          <Toggle label={`Hide amounts: ${s.hideAmounts ? 'on' : 'off'}`} onPress={() => update({ hideAmounts: !s.hideAmounts })} />
          <Toggle label={`Compact: ${s.compactNumbers ? 'on' : 'off'}`} onPress={() => update({ compactNumbers: !s.compactNumbers })} />
          <Toggle label={`Format: ${s.numberFormat}`} onPress={() => update({ numberFormat: nextFormat })} />
          <Toggle label={`Theme: ${s.theme}`} onPress={() => update({ theme: nextTheme })} />
          <Toggle
            label={`Today: ${pinned ? `${SAMPLE_TODAY} (sample)` : 'real'}`}
            onPress={() => {
              setSampleClock(!pinned);
              setPinned(!pinned);
              // Touch the database so live screens recompute with the new "today".
              update({ hideAmounts: s.hideAmounts });
            }}
          />
          <Toggle label="Reset sample data" onPress={() => resetSampleData(db)} />
          <Toggle label="Home →" onPress={() => router.dismissTo('/')} />
        </View>

        <Text style={[styles.label, { color: colors.inkMuted }]}>FORMATTING</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {EXAMPLES.map((e, i) => (
            <View key={i} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
              <Text style={[styles.raw, { color: colors.inkMuted }]}>{e.value}</Text>
              <Money value={e.value} currency={e.currency} sign={e.sign} style={styles.amount} />
            </View>
          ))}
        </View>

        <Text style={[styles.label, { color: colors.inkMuted }]}>SEEDED ACCOUNTS</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {accountRows.map((a, i) => (
            <View key={a.id} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
              <View style={[styles.dot, { backgroundColor: swatch(a.color).bg }]}>
                <View style={[styles.dotInner, { backgroundColor: swatch(a.color).fg }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: colors.ink }]}>{a.name}</Text>
                <Text style={[styles.code, { color: colors.inkMuted }]}>{a.currency}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Toggle({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.toggle, { borderColor: colors.border }]}>
      <Text style={[styles.toggleText, { color: colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 10 },
  title: { fontFamily: fonts.serif, fontSize: 26 },
  sub: { fontFamily: fonts.sans, fontSize: 13, marginBottom: 6 },
  toggles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggle: {
    height: BUTTON_HEIGHT,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderRadius: radius.field,
    justifyContent: 'center',
  },
  toggleText: { fontFamily: fonts.sansBold, fontSize: 13 },
  label: { fontFamily: fonts.sansExtraBold, fontSize: 12, letterSpacing: 0.96, marginTop: 12 },
  card: { borderRadius: radius.card, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 48 },
  raw: { fontFamily: fonts.mono, fontSize: 11, flex: 1 },
  amount: { fontSize: 15 },
  dot: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dotInner: { width: 12, height: 12, borderRadius: radius.pill },
  name: { fontFamily: fonts.sansSemiBold, fontSize: 15 },
  code: { fontFamily: fonts.sans, fontSize: 12 },
});
