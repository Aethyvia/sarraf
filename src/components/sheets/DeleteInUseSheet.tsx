import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { BottomSheet, Button, LinkButton, SheetOption } from '@/components/ui';
import type { DeletionImpact } from '@/data/transaction-sets';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { fonts, radius, useTheme } from '@/theme';

export type DeletableKind = 'account' | 'category' | 'person' | 'ledger';

export interface DeleteExtras {
  /** People: splits where only their share goes; transactions where only the tag goes. */
  splits?: number;
  tagged?: number;
  /** Ledgers: budgets deleted with it. */
  budgets?: number;
}

/**
 * "Delete something still in use": says how many transactions use it and over
 * which dates, then offers Archive instead (highlighted), Move (categories and
 * ledgers), Delete with its transactions, or Keep it. Something unused gets a
 * plain confirmation.
 */
export function DeleteInUseSheet({
  visible,
  kind,
  name,
  impact,
  extras = {},
  archiveNote,
  moveTargets,
  onArchive,
  onMove,
  onDelete,
  onClose,
}: {
  visible: boolean;
  kind: DeletableKind;
  name: string;
  impact: DeletionImpact;
  extras?: DeleteExtras;
  /** Extra lines under "Archive instead", e.g. the account's balance that stops counting. */
  archiveNote?: ReactNode;
  moveTargets?: { id: string; name: string }[];
  onArchive?: () => void;
  onMove?: (targetId: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [picking, setPicking] = useState(false);
  const s = strings.deleteInUse;
  const n = impact.count;
  const sideEffects = (extras.splits ?? 0) + (extras.tagged ?? 0) + (extras.budgets ?? 0) > 0;
  const close = () => {
    setPicking(false);
    onClose();
  };

  if (picking && moveTargets && onMove) {
    return (
      <BottomSheet visible={visible} onClose={close} title={s.pickTarget(kind)}>
        <ScrollView style={{ maxHeight: 420 }}>
          {moveTargets.map((t) => (
            <SheetOption
              key={t.id}
              title={t.name}
              onPress={() => {
                setPicking(false);
                onMove(t.id);
              }}
            />
          ))}
        </ScrollView>
      </BottomSheet>
    );
  }

  const otherEffects = (
    <>
      {impact.otherAccounts.length > 0 ? (
        <Text style={[styles.warn, { color: colors.expense }]}>{s.otherAccounts(joinNames(impact.otherAccounts))}</Text>
      ) : null}
      {kind !== 'person' && impact.people.length > 0 ? (
        <Text style={[styles.warn, { color: colors.expense }]}>{s.otherPeople(joinNames(impact.people))}</Text>
      ) : null}
    </>
  );

  return (
    <BottomSheet visible={visible} onClose={close}>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: 12 }}>
        <Text style={[styles.title, { color: colors.ink }]}>{s.title(name)}</Text>
        <Text style={[styles.body, { color: colors.inkSecondary }]}>
          {n > 0 ? s.usedBy(n, kind, formatShortDate(impact.firstDate!), formatShortDate(impact.lastDate!)) : s.notUsed(kind)}
        </Text>
        {kind === 'person' && extras.splits ? <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.personSplits(extras.splits)}</Text> : null}
        {kind === 'person' && extras.tagged ? <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.personTagged(extras.tagged)}</Text> : null}
        {extras.budgets ? <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.budgetsGo(extras.budgets)}</Text> : null}

        {n > 0 || sideEffects ? (
          <>
            {onArchive ? (
              <Choice highlighted title={s.archiveTitle(kind)} onPress={onArchive}>
                <Text style={[styles.detail, { color: colors.inkSecondary }]}>
                  {kind === 'account' ? s.archiveAccount : s.archiveOther}
                </Text>
                {archiveNote}
              </Choice>
            ) : null}
            {moveTargets && onMove && n > 0 ? (
              <Choice title={s.moveTitle(kind)} onPress={() => setPicking(true)} disabled={moveTargets.length === 0}>
                <Text style={[styles.detail, { color: colors.inkSecondary }]}>{s.moveDetail}</Text>
              </Choice>
            ) : null}
            <Choice danger title={n > 0 ? s.deleteTitle(kind, n) : s.deletePlain(name)} onPress={onDelete}>
              {n > 0 ? <Text style={[styles.detail, { color: colors.inkSecondary }]}>{s.deleteDetail}</Text> : null}
              {otherEffects}
            </Choice>
          </>
        ) : (
          <Button label={s.confirmDelete} onPress={onDelete} style={{ backgroundColor: colors.expense }} />
        )}
        <LinkButton label={strings.common.keepIt} onPress={close} />
      </ScrollView>
    </BottomSheet>
  );
}

function Choice({
  title,
  children,
  onPress,
  highlighted,
  danger,
  disabled,
}: {
  title: string;
  children?: ReactNode;
  onPress: () => void;
  highlighted?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.choice,
        { borderColor: highlighted ? colors.accent : colors.border, backgroundColor: highlighted ? colors.accentSoft : 'transparent' },
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text style={[styles.choiceTitle, { color: danger ? colors.expense : highlighted ? colors.accent : colors.ink }]}>{title}</Text>
      {children}
    </Pressable>
  );
}

function joinNames(items: { name: string }[]): string {
  const names = items.map((i) => i.name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.serif, fontSize: 20 },
  body: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19 },
  choice: { borderWidth: 1.5, borderRadius: radius.card, padding: 14, gap: 4 },
  choiceTitle: { fontFamily: fonts.sansBold, fontSize: 14 },
  detail: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17 },
  warn: { fontFamily: fonts.sansSemiBold, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
});
