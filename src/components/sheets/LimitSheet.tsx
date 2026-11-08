import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { BottomSheet, Button, LinkButton } from '@/components/ui';
import { FREE_LIMITS, usage, type LimitedKind } from '@/data/limits';
import { strings } from '@/i18n/strings';
import { useLive } from '@/state/live';
import { fonts, radius, useTheme } from '@/theme';

/**
 * "Free limit reached": shows usage of every limit, then Upgrade / Archive / Keep.
 * Nothing the user already has is ever locked or deleted.
 */
export function LimitSheet({
  kind,
  itemName,
  onClose,
  onArchive,
}: {
  kind: LimitedKind | null;
  itemName?: string | null;
  onClose: () => void;
  onArchive?: () => void;
}) {
  const { colors } = useTheme();
  const used = useLive((db) => ({
    accounts: usage(db, 'accounts'),
    ledgers: usage(db, 'ledgers'),
    goals: usage(db, 'goals'),
  }));
  if (!kind) return null;
  const s = strings.limit;
  const n = FREE_LIMITS[kind];

  return (
    <BottomSheet visible onClose={onClose}>
      <View style={{ gap: 12 }}>
        <Text style={[styles.title, { color: colors.ink }]}>{s.title(kind === 'goals' ? 'savings goals' : kind, n)}</Text>
        <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.body(kind, used[kind], itemName ?? null)}</Text>
        <View style={[styles.usage, { backgroundColor: colors.filled }]}>
          {(Object.keys(FREE_LIMITS) as LimitedKind[]).map((k) => (
            <View key={k} style={styles.usageRow}>
              <Text style={[styles.usageLabel, { color: colors.ink }]}>{s.usage[k]}</Text>
              <Text style={[styles.usageValue, { color: used[k] >= FREE_LIMITS[k] ? colors.expense : colors.inkSecondary }]}>
                {s.of(used[k], FREE_LIMITS[k])}
              </Text>
            </View>
          ))}
        </View>
        <Button
          label={s.seePlus}
          onPress={() => {
            onClose();
            router.push('/plans');
          }}
        />
        {onArchive ? <Button kind="secondary" label={s.archive[kind]} onPress={onArchive} /> : null}
        <LinkButton label={s.keep(used[kind])} onPress={onClose} />
        <Text style={[styles.footer, { color: colors.inkMuted }]}>{s.footer}</Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.serif, fontSize: 20 },
  body: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19 },
  usage: { borderRadius: radius.field, padding: 12, gap: 8 },
  usageRow: { flexDirection: 'row', justifyContent: 'space-between' },
  usageLabel: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
  usageValue: { fontFamily: fonts.mono, fontSize: 13 },
  footer: { fontFamily: fonts.sans, fontSize: 11.5, textAlign: 'center' },
});
