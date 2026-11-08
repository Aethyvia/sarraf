import * as Print from 'expo-print';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Money } from '@/components/Money';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { useLedgerItems } from '@/components/sheets/pickers';
import { Button, Card, Header, IconButton, Screen, SectionLabel, SelectorRow } from '@/components/ui';
import { accountCsvs, buildTaxZip, fiscalYearOf, ledgerName, recordTaxExport, taxSummary, type CurrencyTax, type TaxRange } from '@/data/tax-export';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { addDays, today } from '@/lib/dates';
import { unb64 } from '@/lib/backup-crypto';
import { dec, formatExact, type NumberFormat } from '@/lib/money';
import { useLive } from '@/state/live';
import { goBack } from '@/state/nav';
import { useSettings } from '@/state/settings';
import { useToast } from '@/state/toast';
import { fonts, useTheme } from '@/theme';
import { shareFile } from '@/services/share-file';

const long = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** The summary PDF: totals per currency, never combined. Exact amounts (Hide amounts doesn't apply to a file you asked for). */
function summaryHtml(rows: CurrencyTax[], range: string, ledger: string, format: NumberFormat): string {
  const s = strings.taxExport;
  const m = (v: string, c: string) => formatExact(v, c, { numberFormat: format });
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<html><head><meta charset="utf-8"><style>
body{font-family:sans-serif;color:#211D17;padding:32px}h1{font-size:20px}p{color:#6B6355;font-size:12px}
table{border-collapse:collapse;width:100%;margin-top:18px}td,th{padding:8px;border-bottom:1px solid #EFE9DC;text-align:left;font-size:13px}
td.n{text-align:right;font-family:monospace}th{color:#948C7C;font-size:11px;text-transform:uppercase}</style></head><body>
<h1>${esc(s.pdfTitle(range))}</h1><p>${esc(ledger)}</p><p>${esc(s.pdfNote)}</p>
<table><tr><th>Currency</th><th>${esc(s.gross)}</th><th>${esc(s.expenses)}</th><th>${esc(s.withheld)}</th></tr>
${rows.map((r) => `<tr><td>${r.currency}</td><td class="n">${m(r.grossIncome, r.currency)}</td><td class="n">${m(r.expenses, r.currency)}</td><td class="n">${m(r.taxWithheld, r.currency)}</td></tr>`).join('')}
</table></body></html>`;
}

/** Settings → Tax export (TaxExport board): fiscal year, all ledgers by default, one zip. */
export default function TaxExportScreen() {
  const s = strings.taxExport;
  const { colors } = useTheme();
  const toast = useToast();
  const set = useSettings();
  const ledgers = useLedgerItems();
  const [year, setYear] = useState<TaxRange>(() => fiscalYearOf(today(), set.fiscalYearStartMonth));
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = useLive((d) => ({ rows: taxSummary(d, year, ledgerId), accountFiles: accountCsvs(d, year).length }), [year, ledgerId]);
  const shift = (dir: 1 | -1) => setYear((y) => fiscalYearOf(addDays(dir === 1 ? y.to : y.from, dir), set.fiscalYearStartMonth));
  const rangeText = `${long(year.from)} – ${long(year.to)}`;

  const run = async () => {
    setBusy(true);
    try {
      const html = summaryHtml(data.rows, rangeText, ledgerName(db, ledgerId) ?? s.allLedgers, set.numberFormat as NumberFormat);
      // Asked for as base64: the PDF file itself sits where only the print module may read it.
      const { base64 } = await Print.printToFileAsync({ html, base64: true });
      const zip = buildTaxZip(db, year, ledgerId, base64 ? unb64(base64) : null);
      await shareFile(`sarraf-tax-${year.from.slice(0, 4)}-${year.to.slice(0, 4)}.zip`, zip, 'application/zip');
      recordTaxExport(db, year, new Date().toISOString());
    } catch (e) {
      toast({ message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const line = (label: string, value: string, currency: string, sign?: 'minus') => (
    <View style={styles.line}>
      <Text style={[styles.label, { color: colors.inkSecondary }]}>{label}</Text>
      <Money value={value} currency={currency} sign={sign} allowCompact={false} style={[styles.amount, { color: colors.ink }]} />
    </View>
  );

  return (
    <Screen>
      <Header size={20} title={s.title} onBack={goBack} />
      <View style={styles.yearRow}>
        <IconButton icon="back" label={s.previousYear} onPress={() => shift(-1)} />
        <View style={[styles.year, { backgroundColor: colors.filled }]}>
          <Text style={[styles.yearLabel, { color: colors.inkMuted }]}>{s.fiscalYear}</Text>
          <Text style={[styles.yearValue, { color: colors.ink }]}>{rangeText}</Text>
        </View>
        <IconButton icon="forward" label={s.nextYear} onPress={() => shift(1)} />
      </View>
      <SelectorRow label={s.ledgers} value={ledgerId ? (ledgers.find((l) => l.id === ledgerId)?.title ?? '') : s.allLedgers} onPress={() => setPicking(true)} />
      <Text style={[styles.small, { color: colors.inkMuted }]}>{s.perCurrency}</Text>
      {data.rows.length === 0 ? <Text style={[styles.small, { color: colors.inkSecondary }]}>{s.nothing}</Text> : null}
      {data.rows.map((r) => (
        <Card key={r.currency} style={styles.card}>
          <SectionLabel>{r.currency}</SectionLabel>
          {line(s.gross, r.grossIncome, r.currency)}
          {line(s.expenses, r.expenses, r.currency, dec(r.expenses).isZero() ? undefined : 'minus')}
          {line(s.withheld, r.taxWithheld, r.currency)}
        </Card>
      ))}
      <SectionLabel>{s.inZip}</SectionLabel>
      <Card style={styles.card}>
        {[...s.files, s.accountsFile(data.accountFiles)].map(([name, detail]) => (
          <View key={name} style={{ paddingVertical: 6 }}>
            <Text style={[styles.file, { color: colors.ink }]}>{name}</Text>
            <Text style={[styles.small, { color: colors.inkMuted, paddingHorizontal: 0 }]}>{detail}</Text>
          </View>
        ))}
      </Card>
      <Button label={busy ? s.working : s.export} disabled={busy} onPress={() => void run()} />
      <PickerSheet
        visible={picking}
        title={s.ledgers}
        sections={[{ items: [{ id: '', title: s.allLedgers }, ...ledgers] }]}
        selectedId={ledgerId ?? ''}
        onSelect={(id) => setLedgerId(id || null)}
        onClose={() => setPicking(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  year: { flex: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 },
  yearLabel: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.5 },
  yearValue: { fontFamily: fonts.sansSemiBold, fontSize: 14.5 },
  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { padding: 16, gap: 6 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontFamily: fonts.sans, fontSize: 13 },
  amount: { fontFamily: fonts.monoSemiBold, fontSize: 13.5 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 2 },
  file: { fontFamily: fonts.monoSemiBold, fontSize: 12.5 },
});
