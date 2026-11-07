import { and, count, eq, isNull, ne } from 'drizzle-orm';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DeleteInUseSheet } from '@/components/sheets/DeleteInUseSheet';
import { IconColorSheet } from '@/components/sheets/IconColorSheet';
import {
  BottomSheet,
  Button,
  Field,
  Header,
  Hint,
  IconButton,
  IconChip,
  LinkButton,
  Screen,
  Segmented,
  SelectorRow,
  SheetOption,
} from '@/components/ui';
import {
  archiveCategory,
  categoryDeletionImpact,
  createCategory,
  deleteCategory,
  unarchiveCategory,
  updateCategory,
  type Category,
  type CategoryKind,
} from '@/data/categories';
import { db } from '@/db/client';
import { categories, transactions } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { fonts, useTheme } from '@/theme';

const DEFAULT_LOOK = { icon: 'circle', color: 'neutral' };

/** Add category or Edit category: name, kind (locked once used), icon & color, parent (two levels). */
export function CategoryForm({
  category,
  initialKind = 'expense',
  initialParentId = null,
}: {
  category?: Category;
  initialKind?: CategoryKind;
  initialParentId?: string | null;
}) {
  const s = strings.categories;
  const { colors } = useTheme();
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? initialKind);
  const [parentId, setParentId] = useState<string | null>(category ? category.parentId : initialParentId);
  const [look, setLook] = useState({ icon: category?.icon ?? DEFAULT_LOOK.icon, color: category?.color ?? DEFAULT_LOOK.color });
  const [sheet, setSheet] = useState<'icon' | 'parent' | 'delete' | null>(null);
  const action = useAction();

  const info = useLive(
    (d) => {
      const id = category?.id ?? '';
      const children = d.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id)).all();
      const ids = [id, ...children.map((c) => c.id)];
      const used = ids.reduce((n, cid) => n + (d.select({ n: count() }).from(transactions).where(eq(transactions.categoryId, cid)).get()?.n ?? 0), 0);
      return {
        hasChildren: children.length > 0,
        used,
        parents: d
          .select()
          .from(categories)
          .where(and(isNull(categories.parentId), isNull(categories.archivedAt), ne(categories.id, id), eq(categories.isSystem, false)))
          .orderBy(categories.name)
          .all(),
        sameKind: d
          .select({ id: categories.id, name: categories.name, kind: categories.kind })
          .from(categories)
          .where(and(ne(categories.id, id), isNull(categories.archivedAt)))
          .orderBy(categories.name)
          .all(),
      };
    },
    [category?.id],
  );
  const impact = useLive((d) => (sheet === 'delete' && category ? categoryDeletionImpact(d, category.id) : null), [sheet, category?.id]);

  const isSystem = !!category?.isSystem;
  const kindLocked = isSystem || info.used > 0 || (parentId !== null && !!category);
  const parent = info.parents.find((p) => p.id === parentId);
  const canSave = name.trim() !== '';

  const save = () => {
    if (!canSave) return;
    const ok = action.run(() => {
      if (category) {
        updateCategory(db, category.id, {
          name,
          icon: look.icon,
          color: look.color,
          ...(kind !== category.kind ? { kind } : {}),
          ...(parentId !== category.parentId ? { parentId } : {}),
        });
      } else {
        createCategory(db, { name, kind, parentId, icon: look.icon, color: look.color });
      }
      return true;
    });
    if (ok) router.back();
  };

  return (
    <Screen>
      <Header
        title={category ? s.edit : s.add}
        onBack={() => router.back()}
        backIcon="close"
        actions={<IconButton icon="tick" filled label={strings.common.save} onPress={save} disabled={!canSave} />}
      />
      {action.ui}

      <Field label={strings.accounts.name} value={name} onChangeText={setName} autoCapitalize="words" />

      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: colors.inkMuted }]}>{s.kind.toUpperCase()}</Text>
        <Segmented
          options={[
            { value: 'expense', label: s.kinds.expense },
            { value: 'income', label: s.kinds.income },
          ]}
          value={kind}
          onChange={(k) => {
            setKind(k);
            if (parent && parent.kind !== k) setParentId(null);
          }}
          disabled={kindLocked}
          tint={{ expense: colors.expense, income: colors.income }}
        />
      </View>
      {info.used > 0 && !isSystem ? <Hint>{s.kindLocked(info.used)}</Hint> : null}
      {isSystem ? <Hint>{s.feesHint}</Hint> : null}

      <SelectorRow
        chevron="forward"
        leading={<IconChip icon={look.icon} color={look.color} size={44} />}
        value={strings.accounts.iconColor}
        onPress={() => setSheet('icon')}
      />

      {!isSystem ? (
        <>
          <SelectorRow
            label={s.parent}
            value={parent?.name ?? s.topLevel}
            onPress={() => setSheet('parent')}
            locked={info.hasChildren}
          />
          <Hint>{s.parentHint}</Hint>
        </>
      ) : null}

      <Button label={strings.common.save} onPress={save} disabled={!canSave} />

      {category && !isSystem ? (
        <>
          {category.archivedAt ? (
            <Button kind="secondary" label={strings.common.unarchive} onPress={() => action.run(() => unarchiveCategory(db, category.id))} />
          ) : (
            <Button kind="danger" label={s.archive} onPress={() => action.run(() => archiveCategory(db, category.id))} />
          )}
          <LinkButton danger label={s.delete} onPress={() => setSheet('delete')} />
        </>
      ) : null}

      <IconColorSheet
        visible={sheet === 'icon'}
        title={name.trim() || s.add}
        icon={look.icon}
        color={look.color}
        defaults={DEFAULT_LOOK}
        onSave={setLook}
        onClose={() => setSheet(null)}
      />
      <BottomSheet visible={sheet === 'parent'} onClose={() => setSheet(null)} title={s.parent}>
        <SheetOption title={s.topLevel} selected={parentId === null} onPress={() => (setParentId(null), setSheet(null))} />
        {info.parents
          .filter((p) => p.kind === kind)
          .map((p) => (
            <SheetOption
              key={p.id}
              title={p.name}
              leading={<IconChip icon={p.icon} color={p.color} size={30} />}
              selected={parentId === p.id}
              onPress={() => (setParentId(p.id), setSheet(null))}
            />
          ))}
      </BottomSheet>
      {category && impact ? (
        <DeleteInUseSheet
          visible={sheet === 'delete'}
          kind="category"
          name={category.name}
          impact={impact}
          moveTargets={info.sameKind.filter((c) => c.kind === category.kind)}
          onArchive={
            category.archivedAt
              ? undefined
              : () => {
                  setSheet(null);
                  action.run(() => archiveCategory(db, category.id));
                }
          }
          onMove={(targetCategoryId) => {
            setSheet(null);
            if (action.run(() => deleteCategory(db, category.id, { mode: 'move', targetCategoryId }))) router.back();
          }}
          onDelete={() => {
            setSheet(null);
            if (action.run(() => deleteCategory(db, category.id, { mode: 'delete_with_transactions' }))) router.back();
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42 },
});
