import { goBack } from '@/state/nav';
import { router } from 'expo-router';
import { useState } from 'react';

import { DeleteInUseSheet } from '@/components/sheets/DeleteInUseSheet';
import { Button, Field, Header, Hint, IconButton, LinkButton, Screen } from '@/components/ui';
import {
  archivePerson,
  createPerson,
  deletePerson,
  personDeletionImpact,
  unarchivePerson,
  updatePerson,
  type Person,
} from '@/data/people';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { deleteStoredFiles } from '@/services/attachments';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';

/** Add person (name + optional note) or edit one, with archive and delete. */
export function PersonForm({ person }: { person?: Person }) {
  const s = strings.people;
  const [name, setName] = useState(person?.name ?? '');
  const [note, setNote] = useState(person?.note ?? '');
  const [deleting, setDeleting] = useState(false);
  const action = useAction();
  const impact = useLive((d) => (deleting && person ? personDeletionImpact(d, person.id) : null), [deleting, person?.id]);
  const canSave = name.trim() !== '';

  const save = () => {
    if (!canSave) return;
    const ok = action.run(() => {
      if (person) updatePerson(db, person.id, { name, note });
      else createPerson(db, { name, note });
      return true;
    });
    if (ok) router.back();
  };

  return (
    <Screen>
      <Header
        title={person ? person.name : s.add}
        onBack={goBack}
        backIcon={person ? 'back' : 'close'}
        actions={<IconButton icon="tick" filled label={strings.common.save} onPress={save} disabled={!canSave} />}
      />
      {action.ui}
      <Field label={strings.accounts.name} value={name} onChangeText={setName} placeholder={s.namePlaceholder} autoCapitalize="words" />
      <Field label={s.note} optional value={note} onChangeText={setNote} placeholder={s.notePlaceholder} multiline />
      <Button label={strings.common.save} onPress={save} disabled={!canSave} />

      {person ? (
        <>
          <Hint>{s.balancesSoon}</Hint>
          {person.archivedAt ? (
            <Button kind="secondary" label={strings.common.unarchive} onPress={() => action.run(() => unarchivePerson(db, person.id))} />
          ) : (
            <Button kind="danger" label={s.archive} onPress={() => action.run(() => archivePerson(db, person.id))} />
          )}
          <LinkButton danger label={s.delete} onPress={() => setDeleting(true)} />
        </>
      ) : null}

      {person && impact ? (
        <DeleteInUseSheet
          visible={deleting}
          kind="person"
          name={person.name}
          impact={impact}
          extras={{ splits: impact.splits, tagged: impact.tagged }}
          onArchive={
            person.archivedAt
              ? undefined
              : () => {
                  setDeleting(false);
                  action.run(() => archivePerson(db, person.id));
                }
          }
          onDelete={() => {
            setDeleting(false);
            const result = action.run(() => deletePerson(db, person.id));
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
