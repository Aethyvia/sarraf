import { goBack } from '@/state/nav';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DeleteInUseSheet } from '@/components/sheets/DeleteInUseSheet';
import { Initials } from '@/components/sheets/pickers';
import { BottomSheet, Button, Field, Header, Hint, IconButton, LinkButton, Screen, SheetOption } from '@/components/ui';
import {
  archivePerson,
  createPerson,
  deletePerson,
  personDeletionImpact,
  setPersonPhoto,
  unarchivePerson,
  updatePerson,
  type Person,
} from '@/data/people';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { deleteStoredFiles } from '@/services/attachments';
import { deletePersonPhotoFile, pickPersonPhoto } from '@/services/person-photo';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { fonts, useTheme } from '@/theme';

/** Add person (name + optional note) or edit one, with archive and delete. */
export function PersonForm({ person }: { person?: Person }) {
  const s = strings.people;
  const [name, setName] = useState(person?.name ?? '');
  const [note, setNote] = useState(person?.note ?? '');
  const [deleting, setDeleting] = useState(false);
  // Profile picture (owner, Nov 20): a newly picked file is stored right away; it's
  // only linked on Save (an unsaved pick is cleared by the app-open sweep).
  const [photo, setPhoto] = useState<string | null>(person?.photoPath ?? null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const { colors } = useTheme();
  const action = useAction();
  const impact = useLive((d) => (deleting && person ? personDeletionImpact(d, person.id) : null), [deleting, person?.id]);
  const canSave = name.trim() !== '';

  const save = () => {
    if (!canSave) return;
    const removed = action.run(() => {
      const id = person ? person.id : createPerson(db, { name, note });
      if (person) updatePerson(db, person.id, { name, note });
      return setPersonPhoto(db, id, photo).removedPath ?? '';
    });
    if (removed === undefined) return;
    if (removed) deletePersonPhotoFile(removed);
    router.back();
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
      <View style={styles.photoRow}>
        <Pressable onPress={() => setPhotoSheet(true)} accessibilityRole="button" accessibilityLabel={photo ? s.changePhoto : s.addPhoto}>
          <Initials name={name || '?'} size={64} photo={photo} />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Pressable onPress={() => setPhotoSheet(true)} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.photoLink, { color: colors.accent }]}>{photo ? s.changePhoto : s.addPhoto}</Text>
          </Pressable>
          <Text style={[styles.photoNote, { color: colors.inkMuted }]}>{s.photoNote}</Text>
        </View>
      </View>
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

      <BottomSheet visible={photoSheet} onClose={() => setPhotoSheet(false)} title={s.photo}>
        {(['camera', 'gallery'] as const).map((source) => (
          <SheetOption
            key={source}
            title={source === 'camera' ? s.takePhoto : s.choosePhoto}
            onPress={async () => {
              setPhotoSheet(false);
              const picked = await pickPersonPhoto(source);
              if (picked) setPhoto(picked);
            }}
          />
        ))}
        {photo ? (
          <SheetOption
            danger
            title={s.removePhoto}
            onPress={() => {
              setPhotoSheet(false);
              setPhoto(null);
            }}
          />
        ) : null}
      </BottomSheet>

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

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  photoLink: { fontFamily: fonts.sansBold, fontSize: 14.5 },
  photoNote: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16 },
});
