import { File, Paths } from 'expo-file-system';
import { strToU8, zipSync } from 'fflate';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { DateRangeSheet, type DateRange } from '@/components/sheets/FilterSheets';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { useLedgerItems } from '@/components/sheets/pickers';
import { Button, Header, Screen, Segmented, SelectorRow, ToggleRow } from '@/components/ui';
import { sarrafJson, transactionsCsv } from '@/data/export';
import { db } from '@/db/client';
import { attachments } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { today } from '@/lib/dates';
import { formatShortDate } from '@/lib/format-date';
import { shareFile } from '@/services/share-file';
import { goBack } from '@/state/nav';
import { useToast } from '@/state/toast';
import { fonts, useTheme } from '@/theme';

/** Settings → Export data (DataExport board). Always free. */
export default function ExportScreen() {
  const s = strings.dataExport;
  const { colors } = useTheme();
  const toast = useToast();
  const ledgers = useLedgerItems();
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [withFiles, setWithFiles] = useState(false);
  const [sheet, setSheet] = useState<'ledger' | 'range' | null>(null);
  const [busy, setBusy] = useState(false);

  const rangeLabel = range.from || range.to ? `${range.from ? formatShortDate(range.from) : '…'} – ${range.to ? formatShortDate(range.to) : '…'}` : s.allTime;

  const run = async () => {
    setBusy(true);
    try {
      const filter = { ledgerId, from: range.from, to: range.to };
      const base = `sarraf-${today()}`;
      const content = format === 'csv' ? transactionsCsv(db, filter) : sarrafJson(db, filter);
      const name = `${base}.${format}`;
      if (!withFiles) {
        await shareFile(name, content, format === 'csv' ? 'text/csv' : 'application/json');
        return;
      }
      const files: Record<string, Uint8Array> = { [name]: strToU8(content) };
      for (const a of db.select().from(attachments).all()) {
        const f = new File(Paths.document, a.filePath);
        if (f.exists) files[a.filePath] = f.bytesSync();
      }
      await shareFile(`${base}.zip`, zipSync(files), 'application/zip');
    } catch (e) {
      toast({ message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title={s.title} onBack={goBack} />
      <Segmented
        options={[
          { value: 'csv', label: s.csv },
          { value: 'json', label: s.json },
        ]}
        value={format}
        onChange={setFormat}
      />
      <SelectorRow label={s.ledger} value={ledgerId ? (ledgers.find((l) => l.id === ledgerId)?.title ?? '') : s.allLedgers} onPress={() => setSheet('ledger')} />
      <SelectorRow label={s.range} value={rangeLabel} onPress={() => setSheet('range')} />
      <Text style={[styles.small, { color: colors.inkMuted }]}>{s.rangeNote}</Text>
      <ToggleRow title={s.attachments} detail={s.attachmentsDetail} value={withFiles} onChange={setWithFiles} />
      <Text style={[styles.small, { color: colors.inkMuted }]}>{format === 'csv' ? s.note : s.jsonNote}</Text>
      <Button label={busy ? s.working : format === 'csv' ? s.exportCsv : s.exportJson} disabled={busy} onPress={() => void run()} />

      <PickerSheet
        visible={sheet === 'ledger'}
        title={s.ledger}
        sections={[{ items: [{ id: '', title: s.allLedgers }, ...ledgers] }]}
        selectedId={ledgerId ?? ''}
        onSelect={(id) => setLedgerId(id || null)}
        onClose={() => setSheet(null)}
      />
      <DateRangeSheet visible={sheet === 'range'} value={range} onApply={setRange} onClose={() => setSheet(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 2 },
});
