import { goBack } from '@/state/nav';
import { eq } from 'drizzle-orm';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { CurrencySheet } from '@/components/sheets/CurrencySheet';
import { BottomSheet, Header, Screen, SectionLabel, SheetOption, ToggleRow } from '@/components/ui';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { NUMBER_FORMATS } from '@/lib/money';
import { useSettings } from '@/state/settings';
import { fonts, useTheme } from '@/theme';

type SettingsChanges = Partial<typeof settings.$inferInsert>;

function save(values: SettingsChanges) {
  db.update(settings).set({ ...values, updatedAt: new Date().toISOString() }).where(eq(settings.id, 1)).run();
}

export default function SettingsScreen() {
  const s = strings.settings;
  const current = useSettings();
  const { colors } = useTheme();
  const [sheet, setSheet] = useState<'currency' | 'format' | 'theme' | null>(null);
  const go = (href: Href) => router.push(href);

  return (
    <Screen>
      <Header title={s.title} onBack={goBack} />

      <SectionLabel style={styles.section}>{s.organize}</SectionLabel>
      <View>
        <Row icon="accounts" title={s.accounts} onPress={() => go('/accounts')} />
        <Row icon="list" title={s.categories} onPress={() => go('/categories')} />
        <Row icon="ledger" title={s.ledgers} onPress={() => go('/ledgers')} />
        <Row icon="people" title={s.people} onPress={() => go('/people')} />
        <Row icon="cycle" title={strings.recurring.title} onPress={() => go('/recurring')} last />
      </View>

      <SectionLabel style={styles.section}>{s.preferences}</SectionLabel>
      <View>
        <Row icon="coin" title={s.defaultCurrency} value={current.defaultCurrency} mono hint={s.defaultCurrencyHint} onPress={() => setSheet('currency')} />
        <Row icon="rows" title={s.numberFormat} value={current.numberFormat} mono hint={s.numberFormatHint} onPress={() => setSheet('format')} />
        <Row icon="moon" title={s.theme} value={s.themes[current.theme]} onPress={() => setSheet('theme')} last />
      </View>
      <ToggleRow title={s.compactNumbers} detail={s.compactNumbersDetail} value={current.compactNumbers} onChange={(v) => save({ compactNumbers: v })} />

      <SectionLabel style={styles.section}>{s.security}</SectionLabel>
      <ToggleRow title={s.hideAmounts} detail={s.hideAmountsDetail} value={current.hideAmounts} onChange={(v) => save({ hideAmounts: v })} />
      {__DEV__ ? (
        <View>
          <Row icon="code" title="Developer preview" onPress={() => go('/dev')} last />
        </View>
      ) : null}

      <CurrencySheet
        visible={sheet === 'currency'}
        selected={current.defaultCurrency}
        onSelect={(code) => save({ defaultCurrency: code })}
        onClose={() => setSheet(null)}
      />
      <BottomSheet visible={sheet === 'format'} onClose={() => setSheet(null)} title={s.numberFormat}>
        {NUMBER_FORMATS.map((f) => (
          <SheetOption
            key={f}
            title={f.replace(/ /g, ' ')}
            detail={s.numberFormats[f]}
            selected={current.numberFormat === f}
            onPress={() => {
              save({ numberFormat: f });
              setSheet(null);
            }}
          />
        ))}
        <Text style={[styles.sheetNote, { color: colors.inkMuted }]}>{s.numberFormatPkr}</Text>
      </BottomSheet>
      <BottomSheet visible={sheet === 'theme'} onClose={() => setSheet(null)} title={s.theme}>
        {(['system', 'light', 'dark'] as const).map((t) => (
          <SheetOption
            key={t}
            title={s.themes[t]}
            selected={current.theme === t}
            onPress={() => {
              save({ theme: t });
              setSheet(null);
            }}
          />
        ))}
      </BottomSheet>
    </Screen>
  );
}

function Row({
  icon,
  title,
  value,
  mono,
  hint,
  onPress,
  last,
}: {
  icon: string;
  title: string;
  value?: string;
  mono?: boolean;
  hint?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [!last && { borderBottomWidth: 1, borderBottomColor: colors.line }, pressed && { opacity: 0.7 }]}>
      <View style={styles.row}>
        <View style={[styles.rowIcon, { backgroundColor: colors.filled }]}>
          <Icon name={icon} size={16} color={colors.inkSecondary} strokeWidth={1.8} />
        </View>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>
        {value ? <Text style={[mono ? styles.valueMono : styles.value, { color: colors.inkMuted }]}>{value}</Text> : null}
        <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} />
      </View>
      {hint ? <Text style={[styles.hint, { color: colors.inkMuted }]}>{hint}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8, marginBottom: -8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  rowIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { flex: 1, fontFamily: fonts.sansSemiBold, fontSize: 14.5 },
  value: { fontFamily: fonts.sans, fontSize: 13.5 },
  valueMono: { fontFamily: fonts.mono, fontSize: 13.5 },
  hint: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingStart: 48, paddingEnd: 4, paddingBottom: 10, marginTop: -6 },
  sheetNote: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingTop: 10, paddingHorizontal: 4 },
});
