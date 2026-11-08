import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { StyleSheet, Text, View } from 'react-native';

import { Note } from '@/components/start/StartPage';
import { Button, Card } from '@/components/ui';
import { strings } from '@/i18n/strings';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';

/**
 * The recovery key, shown once (Setup 4 of 4 and Backup → Renew): two rows of
 * three groups, Save as file, Copy (cleared from the clipboard after 60 s),
 * and the "not in Google Drive" warning.
 */
export function RecoveryKeyCard({ recoveryKey }: { recoveryKey: string }) {
  const s = strings.start;
  const { colors } = useTheme();
  const toast = useToast();
  const groups = recoveryKey.split('-');

  const saveFile = async () => {
    const f = new File(Paths.cache, 'Sarraf recovery key.txt');
    if (f.exists) f.delete();
    f.create();
    f.write(s.keyFileText(recoveryKey));
    await Sharing.shareAsync(f.uri, { mimeType: 'text/plain', dialogTitle: s.saveFile });
  };
  const copy = async () => {
    await Clipboard.setStringAsync(recoveryKey);
    toast({ message: s.copied });
    setTimeout(async () => {
      if ((await Clipboard.getStringAsync()) === recoveryKey) await Clipboard.setStringAsync('');
    }, 60_000);
  };

  return (
    <View style={{ gap: 16 }}>
      <Card style={styles.card}>
        <Text style={[styles.key, { color: colors.ink }]} selectable>
          {`${groups.slice(0, 3).join('  ')}\n${groups.slice(3).join('  ')}`}
        </Text>
      </Card>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label={s.saveFile} kind="secondary" style={{ flex: 1 }} onPress={() => void saveFile()} />
        <Button label={s.copy} kind="secondary" style={{ flex: 1 }} onPress={() => void copy()} />
      </View>
      <Note tone="amber" icon="key">
        {s.keyWhere}
      </Note>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 20, paddingHorizontal: 16, alignItems: 'center', borderRadius: radius.field },
  key: { fontFamily: fonts.monoSemiBold, fontSize: 19, letterSpacing: 1.5, lineHeight: 30, textAlign: 'center' },
});
