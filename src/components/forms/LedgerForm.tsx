import { goBack } from '@/state/nav';
import { and, count, eq, isNull, ne } from 'drizzle-orm';
import { router } from 'expo-router';
import { useState } from 'react';

import { DeleteInUseSheet } from '@/components/sheets/DeleteInUseSheet';
import { IconColorSheet } from '@/components/sheets/IconColorSheet';
import { Button, Field, Header, Hint, IconButton, IconChip, LinkButton, Screen, SelectorRow, ToggleRow } from '@/components/ui';
import {
  archiveLedger,
  createLedger,
  deleteLedger,
  ledgerDeletionImpact,
  setDefaultLedger,
  unarchiveLedger,
  updateLedger,
  type Ledger,
} from '@/data/ledgers';
import { db } from '@/db/client';
import { ledgers } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { deleteStoredFiles } from '@/services/attachments';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { usePlan } from '@/state/plan';

/** Add ledger or Edit ledger (with default, archive and delete). */
export function LedgerForm({ ledger }: { ledger?: Ledger }) {
  const s = strings.ledgers;
  const plan = usePlan();
  const isFirst = useLive((d) => (d.select({ n: count() }).from(ledgers).get()?.n ?? 0) === 0);
  const defaults = { icon: 'ledger', color: isFirst ? 'teal' : 'neutral' };
  const [name, setName] = useState(ledger?.name ?? '');
  const [look, setLook] = useState<{ icon: string; color: string } | null>(ledger ? { icon: ledger.icon, color: ledger.color } : null);
  const [makeDefault, setMakeDefault] = useState(ledger?.isDefault ?? false);
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const action = useAction({ itemName: name.trim() || null });
  const shown = look ?? defaults;
  const canSave = name.trim() !== '';

  const impact = useLive((d) => (deleting && ledger ? ledgerDeletionImpact(d, ledger.id) : null), [deleting, ledger?.id]);
  const moveTargets = useLive(
    (d) =>
      ledger
        ? d.select({ id: ledgers.id, name: ledgers.name }).from(ledgers).where(and(ne(ledgers.id, ledger.id), isNull(ledgers.archivedAt))).orderBy(ledgers.rank).all()
        : [],
    [ledger?.id],
  );

  const save = () => {
    if (!canSave) return;
    const ok = action.run(() => {
      const id = ledger
        ? (updateLedger(db, ledger.id, { name, icon: shown.icon, color: shown.color }), ledger.id)
        : createLedger(db, { name, icon: shown.icon, color: shown.color }, plan);
      if (makeDefault && !ledger?.isDefault) setDefaultLedger(db, id);
      return true;
    });
    if (ok) router.back();
  };

  return (
    <Screen>
      <Header
        title={ledger ? s.edit : s.add}
        onBack={goBack}
        backIcon="close"
        actions={<IconButton icon="tick" filled label={strings.common.save} onPress={save} disabled={!canSave} />}
      />
      {action.ui}

      <SelectorRow chevron="forward" leading={<IconChip icon={shown.icon} color={shown.color} size={44} />} value={strings.accounts.iconColor} onPress={() => setPicking(true)} />
      <Field label={strings.accounts.name} value={name} onChangeText={setName} placeholder={s.namePlaceholder} autoCapitalize="words" />
      {ledger?.isDefault ? (
        <Hint>{s.defaultLocked}</Hint>
      ) : (
        <ToggleRow title={s.makeDefault} detail={s.makeDefaultDetail} value={makeDefault} onChange={setMakeDefault} />
      )}

      <Button label={s.save} onPress={save} disabled={!canSave} />

      {ledger && !ledger.isDefault ? (
        <>
          {ledger.archivedAt ? (
            <Button kind="secondary" label={strings.common.unarchive} onPress={() => action.run(() => unarchiveLedger(db, ledger.id, plan))} />
          ) : (
            <Button kind="danger" label={s.archive} onPress={() => action.run(() => archiveLedger(db, ledger.id))} />
          )}
          <LinkButton danger label={s.delete} onPress={() => setDeleting(true)} />
        </>
      ) : null}

      <IconColorSheet
        visible={picking}
        title={name.trim() || s.add}
        icon={shown.icon}
        color={shown.color}
        defaults={defaults}
        onSave={setLook}
        onClose={() => setPicking(false)}
      />
      {ledger && impact ? (
        <DeleteInUseSheet
          visible={deleting}
          kind="ledger"
          name={ledger.name}
          impact={impact}
          extras={{ budgets: impact.budgets }}
          moveTargets={moveTargets}
          onArchive={
            ledger.archivedAt
              ? undefined
              : () => {
                  setDeleting(false);
                  action.run(() => archiveLedger(db, ledger.id));
                }
          }
          onMove={(targetLedgerId) => {
            setDeleting(false);
            if (action.run(() => deleteLedger(db, ledger.id, { mode: 'move', targetLedgerId }))) router.back();
          }}
          onDelete={() => {
            setDeleting(false);
            const result = action.run(() => deleteLedger(db, ledger.id, { mode: 'delete_with_transactions' }));
            if (result) {
              deleteStoredFiles(result.attachmentPaths);
              router.back();
            }
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </Screen>
  );
}

export function useLedger(id: string) {
  return useLive((d) => d.select().from(ledgers).where(eq(ledgers.id, id)).get(), [id]);
}
