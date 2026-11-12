import { StyleSheet, Text, View } from 'react-native';

import { ProgressBar } from '@/components/ProgressBar';
import type { BackupProgress } from '@/data/backup-flow';
import { strings } from '@/i18n/strings';
import { fonts, useTheme } from '@/theme';

/** Backup progress (owner, Nov 12): a bar and what's happening now. */
export function BackupProgressCard({ progress }: { progress: BackupProgress }) {
  const s = strings.backup;
  const { colors } = useTheme();
  const done = progress.fraction >= 1;
  const line =
    progress.step === 'attachments' && progress.total ? s.progressAttachments(progress.done ?? 0, progress.total) : s.progressSteps[progress.step];
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.top}>
        <Text style={[styles.title, { color: colors.ink }]}>{done ? s.progressDone : s.progressTitle}</Text>
        <Text style={[styles.pct, { color: colors.inkMuted }]}>{Math.round(progress.fraction * 100)}%</Text>
      </View>
      <ProgressBar value={progress.fraction} />
      {done ? null : <Text style={[styles.line, { color: colors.inkSecondary }]}>{line}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, gap: 10 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  pct: { fontFamily: fonts.monoSemiBold, fontSize: 12.5 },
  line: { fontFamily: fonts.sans, fontSize: 12.5 },
});
