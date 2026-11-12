import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { ICON_GROUPS, PICKABLE_ICONS } from '@/components/icons/shapes';
import { BottomSheet, Button, IconChip, LinkButton } from '@/components/ui';
import { strings } from '@/i18n/strings';
import { SWATCH_KEYS, fonts, radius, useTheme } from '@/theme';

/** Pick an icon and a colour. "Use default" goes back to what Sarraf picked. */
export function IconColorSheet({
  visible,
  title,
  icon,
  color,
  defaults,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  icon: string;
  color: string;
  defaults: { icon: string; color: string };
  onSave: (look: { icon: string; color: string }) => void;
  onClose: () => void;
}) {
  const { colors, swatch } = useTheme();
  const [draft, setDraft] = useState({ icon, color });
  const [shownFor, setShownFor] = useState(visible);
  // Start each opening from the current look.
  if (visible !== shownFor) {
    setShownFor(visible);
    if (visible) setDraft({ icon, color });
  }
  const s = strings.iconPicker;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={s.title}>
      <View style={styles.preview}>
        <IconChip icon={draft.icon} color={draft.color} size={48} />
        <Text style={[styles.previewName, { color: colors.ink }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Text style={[styles.label, { color: colors.inkMuted }]}>{s.color}</Text>
      <View style={styles.colors}>
        {SWATCH_KEYS.map((key) => (
          <Pressable
            key={key}
            onPress={() => setDraft((d) => ({ ...d, color: key }))}
            accessibilityRole="button"
            accessibilityLabel={s.colors[key]}
            accessibilityState={{ selected: draft.color === key }}
            style={[styles.swatch, { backgroundColor: swatch(key).fg }, draft.color === key && { borderColor: colors.ink, borderWidth: 2.5 }]}
          />
        ))}
      </View>
      <Text style={[styles.label, { color: colors.inkMuted }]}>
        {s.icon} · {s.options(PICKABLE_ICONS.length)}
      </Text>
      <ScrollView style={{ maxHeight: 440 }}>
        {ICON_GROUPS.map((g) => (
          <View key={g.key}>
            <Text style={[styles.group, { color: colors.inkMuted }]}>{s.iconGroups[g.key]}</Text>
            <View style={styles.grid}>
              {g.icons.map((name) => {
                const on = draft.icon === name;
                return (
                  <Pressable
                    key={name}
                    onPress={() => setDraft((d) => ({ ...d, icon: name }))}
                    accessibilityRole="button"
                    accessibilityLabel={name}
                    accessibilityState={{ selected: on }}
                    style={[styles.cell, { backgroundColor: on ? swatch(draft.color).bg : colors.filled }, on && { borderColor: swatch(draft.color).fg, borderWidth: 1.5 }]}
                  >
                    <Icon name={name} size={19} color={on ? swatch(draft.color).fg : colors.inkSecondary} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={{ gap: 4, marginTop: 12 }}>
        <Button
          label={strings.common.save}
          onPress={() => {
            onSave(draft);
            onClose();
          }}
        />
        <LinkButton label={s.useDefault} onPress={() => setDraft(defaults)} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingBottom: 8 },
  previewName: { fontFamily: fonts.sansSemiBold, fontSize: 15, flex: 1 },
  label: { fontFamily: fonts.sansExtraBold, fontSize: 11, letterSpacing: 0.7, paddingHorizontal: 4, paddingTop: 10, paddingBottom: 8 },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 4 },
  swatch: { width: 34, height: 34, borderRadius: radius.pill, borderColor: 'transparent', borderWidth: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 2 },
  group: { fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.5, paddingHorizontal: 4, paddingTop: 10, paddingBottom: 6 },
  cell: { width: 44, height: 44, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
});
