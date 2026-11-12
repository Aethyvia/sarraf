import { Text, View } from 'react-native';

import { Note } from '@/components/start/StartPage';
import { BottomSheet, Button, LinkButton } from '@/components/ui';
import type { ExistingBackup } from '@/data/backup-flow';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { fonts, useTheme } from '@/theme';

/**
 * The upload guard's question (council, Nov 12): a backup this phone didn't
 * make is in the Drive. Replace it (it's overwritten), restore it instead, or
 * leave it. Never replaced without asking.
 */
export function ReplaceBackupSheet({
  existing,
  busy,
  onReplace,
  onRestore,
  onClose,
}: {
  existing: ExistingBackup | null;
  busy?: boolean;
  onReplace: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const s = strings.backup;
  const { colors } = useTheme();
  const e = existing;
  return (
    <BottomSheet visible={!!e} onClose={onClose} title={s.existingTitle}>
      {e ? (
        <View style={{ gap: 12 }}>
          <Text style={{ fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: colors.inkSecondary }}>
            {s.existingBody(e.deviceName, `${formatShortDate(e.at.slice(0, 10))}, ${e.at.slice(0, 4)}`, strings.start.insideCounts(e.counts.accounts, e.counts.ledgers, e.counts.transactions))}
          </Text>
          <Note tone="amber">{strings.start.replaceWarn}</Note>
          <Button label={s.existingRestore} onPress={onRestore} />
          <Button label={busy ? strings.start.working : s.existingReplace} kind="secondary" disabled={busy} onPress={onReplace} />
          <LinkButton label={s.existingLeave} onPress={onClose} />
        </View>
      ) : null}
    </BottomSheet>
  );
}
