import { isNull } from 'drizzle-orm';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Initials } from '@/components/sheets/pickers';
import { BottomSheet, Button } from '@/components/ui';
import { createPerson } from '@/data/people';
import { db } from '@/db/client';
import { people } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Add people (Spec §9c, Decided Nov 7): search, tick people (those already in
 * the split shown and greyed), and + New person to create one on the spot.
 * With `single`, picking one person returns right away (Paid by).
 */
export function AddPeopleSheet({
  visible,
  title,
  already = [],
  single,
  onAdd,
  onClose,
}: {
  visible: boolean;
  title?: string;
  already?: string[];
  single?: boolean;
  onAdd: (ids: string[]) => void;
  onClose: () => void;
}) {
  const s = strings.addPeople;
  const { colors } = useTheme();
  const action = useAction();
  const list = useLive((d) => d.select().from(people).where(isNull(people.archivedAt)).orderBy(people.name).all());
  const [query, setQuery] = useState('');
  const [ticked, setTicked] = useState<string[]>([]);
  const [naming, setNaming] = useState<string | null>(null);

  const close = () => {
    setQuery('');
    setTicked([]);
    setNaming(null);
    onClose();
  };
  const finish = (ids: string[]) => {
    onAdd(ids);
    close();
  };
  const toggle = (id: string) => (single ? finish([id]) : setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id])));
  const create = () => {
    const name = naming?.trim();
    if (!name) return;
    const id = action.run(() => createPerson(db, { name }));
    if (!id) return;
    setNaming(null);
    if (single) finish([id]);
    else setTicked((t) => [...t, id]);
  };
  const shown = list.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <BottomSheet visible={visible} onClose={close} title={title ?? s.title}>
      {action.ui}
      <View style={[styles.search, { backgroundColor: colors.filled }]}>
        <Icon name="search" size={14} color={colors.inkMuted} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder={s.search} placeholderTextColor={colors.inkMuted} style={[styles.searchInput, { color: colors.ink }]} />
      </View>
      <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
        {shown.map((p) => {
          const inSplit = already.includes(p.id);
          const on = inSplit || ticked.includes(p.id);
          return (
            <Pressable
              key={p.id}
              disabled={inSplit}
              onPress={() => toggle(p.id)}
              style={[styles.item, { borderBottomColor: colors.line }, inSplit && { opacity: 0.55 }]}
              accessibilityRole={single ? 'button' : 'checkbox'}
              accessibilityState={{ checked: on, disabled: inSplit }}
            >
              <Initials name={p.name} size={32} />
              <Text style={[styles.name, { color: colors.ink }]}>{p.name}</Text>
              {inSplit ? <Text style={[styles.inSplit, { color: colors.inkMuted }]}>{s.inSplit}</Text> : null}
              {!single ? (
                <View
                  style={[
                    styles.check,
                    on ? { backgroundColor: inSplit ? colors.inkMuted : colors.accent, borderColor: 'transparent' } : { borderColor: colors.border },
                  ]}
                >
                  {on ? <Icon name="tick" size={12} color={colors.onAccent} strokeWidth={3} /> : null}
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {naming === null ? (
        <Button kind="dashed" label={s.newPerson} onPress={() => setNaming('')} style={{ marginTop: 10 }} />
      ) : (
        <View style={[styles.newRow, { backgroundColor: colors.filled }]}>
          <TextInput
            value={naming}
            onChangeText={setNaming}
            autoFocus
            placeholder={s.newName}
            placeholderTextColor={colors.inkMuted}
            onSubmitEditing={create}
            style={[styles.searchInput, { color: colors.ink }]}
          />
          <Button label={s.create} onPress={create} disabled={!naming.trim()} style={{ paddingHorizontal: 18 }} />
        </View>
      )}
      {!single ? <Button label={s.add(ticked.length)} disabled={!ticked.length} onPress={() => finish(ticked)} style={{ marginTop: 8 }} /> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 11, paddingHorizontal: 13, marginBottom: 6 },
  searchInput: { flex: 1, fontFamily: fonts.sans, fontSize: 14, paddingVertical: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1 },
  name: { flex: 1, fontFamily: fonts.sansSemiBold, fontSize: 14.5 },
  inSplit: { fontFamily: fonts.sansSemiBold, fontSize: 11 },
  check: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.field, paddingLeft: 13, padding: 4, marginTop: 10 },
});
