import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { BottomSheet, Button, SheetOption } from '@/components/ui';
import type { AttachmentRow } from '@/data/attachments';
import { strings } from '@/i18n/strings';
import { chooseFiles, choosePhotos, formatBytes, takePhoto, type PickedFile } from '@/services/attachments';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Attach (Decided Nov 7): take a photo, choose from the gallery, or choose any
 * file. Shows what's attached, with the shrunk size of photos.
 */
export function AttachSheet({
  visible,
  saved,
  picked,
  onChange,
  onClose,
}: {
  visible: boolean;
  /** Attachments already saved (editing), minus any marked for removal. */
  saved: AttachmentRow[];
  picked: PickedFile[];
  onChange: (change: { add?: PickedFile[]; removePicked?: number; removeSaved?: string }) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const s = strings.attach;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const pick = async (from: () => Promise<PickedFile[] | PickedFile | null>) => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await from();
      const files = Array.isArray(result) ? result : result ? [result] : [];
      if (files.length) onChange({ add: files });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const count = saved.length + picked.length;
  const row = (key: string, name: string, detail: string, onRemove: () => void) => (
    <View key={key} style={[styles.file, { backgroundColor: colors.filled }]}>
      <Icon name="document" size={18} color={colors.inkSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.fileName, { color: colors.ink }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.fileDetail, { color: colors.inkMuted }]}>{detail}</Text>
      </View>
      <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={s.remove}>
        <Icon name="close" size={16} color={colors.inkMuted} />
      </Pressable>
    </View>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title={s.title}>
      <SheetOption title={s.takePhoto} leading={<Icon name="camera" size={20} color={colors.ink} />} onPress={() => pick(takePhoto)} disabled={busy} />
      <SheetOption title={s.gallery} leading={<Icon name="image" size={20} color={colors.ink} />} onPress={() => pick(choosePhotos)} disabled={busy} />
      <SheetOption title={s.file} leading={<Icon name="document" size={20} color={colors.ink} />} onPress={() => pick(chooseFiles)} disabled={busy} />
      {busy ? <ActivityIndicator style={{ marginTop: 12 }} color={colors.accent} /> : null}
      {failed ? <Text style={[styles.hint, { color: colors.expense }]}>{s.failed}</Text> : null}

      {count > 0 ? (
        <View style={{ gap: 8, marginTop: 14 }}>
          <Text style={[styles.label, { color: colors.inkMuted }]}>{s.attached(count)}</Text>
          {saved.map((a) => row(a.id, a.filePath.split('/').pop() ?? a.filePath, formatBytes(a.sizeBytes), () => onChange({ removeSaved: a.id })))}
          {picked.map((f, i) =>
            row(
              `p${i}`,
              f.name,
              f.originalBytes && f.originalBytes > f.sizeBytes ? s.shrunk(formatBytes(f.sizeBytes), formatBytes(f.originalBytes)) : formatBytes(f.sizeBytes),
              () => onChange({ removePicked: i }),
            ),
          )}
        </View>
      ) : null}
      <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.hint}</Text>
      <Button label={s.done} onPress={onClose} style={{ marginTop: 12 }} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.sansExtraBold, fontSize: 11, letterSpacing: 0.7, paddingHorizontal: 4 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.field, paddingHorizontal: 12, paddingVertical: 10 },
  fileName: { fontFamily: fonts.sansSemiBold, fontSize: 13.5 },
  fileDetail: { fontFamily: fonts.sans, fontSize: 11.5 },
  hint: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 4, paddingTop: 10 },
});
