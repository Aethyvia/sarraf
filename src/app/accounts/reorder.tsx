import { isNull } from 'drizzle-orm';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet, Card, Header, IconButton, IconChip, Screen, SheetOption } from '@/components/ui';
import { moveAccount } from '@/data/accounts';
import { db } from '@/db/client';
import { accounts } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { useLive } from '@/state/live';
import { goBack } from '@/state/nav';
import { fonts, useTheme } from '@/theme';

/** Accounts → Custom order: tap a rank number to move an account to that position (like Reorder currencies). */
export default function ReorderAccountsScreen() {
  const s = strings.sort;
  const { colors } = useTheme();
  const list = useLive((d) => d.select().from(accounts).where(isNull(accounts.archivedAt)).orderBy(accounts.rank).all(), []);
  const [moving, setMoving] = useState<string | null>(null);
  const movingName = list.find((a) => a.id === moving)?.name ?? '';
  return (
    <Screen>
      <Header title={s.rearrange} onBack={goBack} backIcon="close" actions={<IconButton icon="tick" filled label={strings.common.save} onPress={() => router.back()} />} />
      <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.rearrangeHint}</Text>
      <Card>
        {list.map((a, i) => (
          <View key={a.id} style={[styles.item, i < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
            <IconChip icon={a.icon} color={a.color} size={34} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.ink }]}>{a.name}</Text>
              <Text style={[styles.sub, { color: colors.inkMuted }]}>{a.currency}</Text>
            </View>
            <Pressable
              onPress={() => setMoving(a.id)}
              accessibilityRole="button"
              accessibilityLabel={strings.currencies.moveTo(a.name)}
              style={[styles.rank, { borderColor: moving === a.id ? colors.warning : colors.border }]}
            >
              <Text style={[styles.rankText, { color: colors.ink }]}>{i + 1}</Text>
            </Pressable>
          </View>
        ))}
      </Card>
      <BottomSheet visible={moving !== null} onClose={() => setMoving(null)} title={strings.currencies.moveTo(movingName)}>
        {list.map((a, i) => (
          <SheetOption
            key={a.id}
            title={strings.currencies.position(i + 1)}
            selected={a.id === moving}
            onPress={() => {
              if (moving) moveAccount(db, moving, i);
              setMoving(null);
            }}
          />
        ))}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, paddingHorizontal: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  name: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  sub: { fontFamily: fonts.sans, fontSize: 11.5 },
  rank: { width: 36, height: 36, borderRadius: 999, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontFamily: fonts.monoSemiBold, fontSize: 14 },
});
