import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet, LinkButton, SheetOption } from '@/components/ui';
import { fonts, radius, useTheme } from '@/theme';

export interface PickerItem {
  id: string;
  title: string;
  detail?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  /** Indents a subcategory under its parent. */
  indent?: boolean;
}

export interface PickerSection {
  label?: string;
  items: PickerItem[];
}

type Row = { type: 'label'; text: string } | { type: 'item'; item: PickerItem };

/**
 * One list-picking bottom sheet for categories, people, ledgers, goals and the
 * like: optional search, labelled sections, a tick on the current choice and a
 * "+ New …" action at the bottom.
 */
export function PickerSheet({
  visible,
  title,
  sections,
  selectedId,
  onSelect,
  onClose,
  searchPlaceholder,
  header,
  newLabel,
  onNew,
  clearLabel,
}: {
  visible: boolean;
  title: string;
  sections: PickerSection[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  searchPlaceholder?: string;
  header?: ReactNode;
  newLabel?: string;
  onNew?: () => void;
  /** Offers a "none" choice (onSelect('')). */
  clearLabel?: string;
}) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Row[] = [];
    for (const s of sections) {
      const items = q ? s.items.filter((i) => i.title.toLowerCase().includes(q)) : s.items;
      if (!items.length) continue;
      if (s.label && !q) out.push({ type: 'label', text: s.label });
      for (const item of items) out.push({ type: 'item', item });
    }
    return out;
  }, [query, sections]);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={close} title={title}>
      {header}
      {searchPlaceholder ? (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          placeholderTextColor={colors.inkMuted}
          autoCorrect={false}
          style={[styles.search, { backgroundColor: colors.filled, color: colors.ink }]}
        />
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.type === 'label' ? `l${i}` : `${i}-${r.item.id}`)}
        keyboardShouldPersistTaps="handled"
        style={{ maxHeight: 440 }}
        ListHeaderComponent={
          clearLabel ? (
            <SheetOption
              title={clearLabel}
              selected={!selectedId}
              onPress={() => {
                onSelect('');
                close();
              }}
            />
          ) : null
        }
        renderItem={({ item: row }) =>
          row.type === 'label' ? (
            <Text style={[styles.label, { color: colors.inkMuted }]}>{row.text}</Text>
          ) : (
            <View style={row.item.indent ? { paddingStart: 28 } : undefined}>
              <SheetOption
                title={row.item.title}
                detail={row.item.detail}
                leading={row.item.leading}
                trailing={row.item.trailing}
                disabled={row.item.disabled}
                selected={row.item.id === selectedId}
                onPress={() => {
                  onSelect(row.item.id);
                  close();
                }}
              />
            </View>
          )
        }
      />
      {onNew && newLabel ? (
        <LinkButton
          label={newLabel}
          onPress={() => {
            close();
            onNew();
          }}
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  search: { borderRadius: radius.field, paddingHorizontal: 14, paddingVertical: 11, fontFamily: fonts.sans, fontSize: 14.5, marginBottom: 6 },
  label: { fontFamily: fonts.sansExtraBold, fontSize: 11, letterSpacing: 0.7, paddingTop: 14, paddingBottom: 4, paddingHorizontal: 4 },
});
