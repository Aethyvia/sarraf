import { goBack } from '@/state/nav';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Badge, Card, Header, IconButton, IconChip, LinkButton, ListRow, Screen, SectionLabel } from '@/components/ui';
import type { Category } from '@/data/categories';
import { categories } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { useLive } from '@/state/live';
import { fonts, useTheme } from '@/theme';

/** Categories by kind, A → Z, each with its subcategories underneath. */
export default function CategoriesScreen() {
  const s = strings.categories;
  const { colors } = useTheme();
  const all = useLive((db) => db.select().from(categories).orderBy(categories.name).all());
  const childrenOf = (id: string) => all.filter((c) => c.parentId === id);

  const section = (kind: 'expense' | 'income') => {
    const top = all.filter((c) => c.kind === kind && !c.parentId);
    return (
      <View style={{ gap: 8 }}>
        <SectionLabel>{kind === 'expense' ? s.expense : s.income}</SectionLabel>
        <Card>
          {top.map((c, i) => (
            <View key={c.id} style={i < top.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.line } : undefined}>
              <ListRow
                last
                title={c.name}
                muted={!!c.archivedAt}
                detail={c.archivedAt ? strings.common.archived : undefined}
                leading={<IconChip icon={c.icon} color={c.color} size={30} />}
                trailing={c.isSystem ? <Badge label={strings.common.builtIn} tone="neutral" /> : undefined}
                onPress={() => router.push(`/categories/${c.id}`)}
              />
              {childrenOf(c.id).map((sub) => (
                <Sub key={sub.id} category={sub} />
              ))}
            </View>
          ))}
        </Card>
        <LinkButton label={`+ ${s.add}`} onPress={() => router.push({ pathname: '/categories/new', params: { kind } })} />
      </View>
    );
  };

  return (
    <Screen>
      <Header
        title={s.title}
        subtitle={s.sortedBy}
        onBack={goBack}
        actions={<IconButton icon="plus" filled label={s.add} onPress={() => router.push('/categories/new')} />}
      />
      {section('expense')}
      {section('income')}
      <Text style={[styles.footer, { color: colors.inkMuted }]}>{s.footer}</Text>
    </Screen>
  );
}

function Sub({ category }: { category: Category }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={() => router.push(`/categories/${category.id}`)} style={({ pressed }) => [styles.sub, pressed && { backgroundColor: colors.filled }]}>
      <View style={[styles.dot, { backgroundColor: colors.border }]} />
      <Text style={[styles.subName, { color: category.archivedAt ? colors.inkMuted : colors.inkSecondary }]}>{category.name}</Text>
      <Icon name="forward" size={12} color={colors.inkMuted} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sub: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingStart: 56, paddingEnd: 14, paddingVertical: 9 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  subName: { flex: 1, fontFamily: fonts.sans, fontSize: 13 },
  footer: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 15, paddingHorizontal: 4 },
});
