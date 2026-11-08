import { eq } from 'drizzle-orm';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Money } from '@/components/Money';
import { parts } from '@/components/parts';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { useAccountSections, useCategorySections } from '@/components/sheets/pickers';
import { Note } from '@/components/start/StartPage';
import { Button, Card, Field, Header, LinkButton, Screen, SelectorRow } from '@/components/ui';
import { commitImport, dateFormatsFor, guessMapping, openingShift, previewImport, savedMapping, type DateFormat, type Field as ColumnField, type PreviewRow } from '@/data/csv-import';
import { importSarrafJson } from '@/data/export';
import { db } from '@/db/client';
import { accounts, categories } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { parseCsv } from '@/lib/csv';
import { formatShortDate } from '@/lib/format-date';
import { dec } from '@/lib/money';
import { readPickedText } from '@/services/share-file';
import { useLive } from '@/state/live';
import { pauseLockFor } from '@/state/lock-pause';
import { goBack } from '@/state/nav';
import { useToast } from '@/state/toast';
import { fonts, radius, useTheme } from '@/theme';

const FIELDS: ColumnField[] = ['date', 'amount', 'debit', 'credit', 'notes', 'category', 'ignore'];
const letter = (i: number) => String.fromCharCode(65 + i);

type Decision = 'import' | 'skip';

/** Settings → Import: a CSV statement into one account (ImportMapping + ImportConfirm boards), or a Sarraf JSON file. */
export default function ImportScreen() {
  const s = strings.dataImport;
  const { colors } = useTheme();
  const toast = useToast();
  const accountSections = useAccountSections();
  const [step, setStep] = useState<'pick' | 'map' | 'confirm'>('pick');
  const [file, setFile] = useState<{ name: string; header: string[]; rows: string[][] } | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  const [columns, setColumns] = useState<ColumnField[]>([]);
  const [dateFormat, setDateFormat] = useState<DateFormat>('ymd');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ kind: 'account' } | { kind: 'column'; index: number } | { kind: 'date' } | { kind: 'category'; line: number } | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [busy, setBusy] = useState(false);
  const account = accountId ? db.select().from(accounts).where(eq(accounts.id, accountId)).get() : undefined;
  const catNames = useLive((d) => new Map(d.select().from(categories).all().map((c) => [c.id, c.name])), []);

  const pick = async (kind: 'csv' | 'json') => {
    pauseLockFor();
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: kind === 'json' ? ['application/json', '*/*'] : ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'] });
    if (r.canceled || !r.assets[0]) return;
    const asset = r.assets[0];
    let text: string;
    try {
      text = await readPickedText(asset.uri);
    } catch (e) {
      return toast({ message: (e as Error).message });
    }
    if (kind === 'json') {
      try {
        const res = importSarrafJson(db, text);
        toast({ message: s.jsonDone(res.added, res.skipped) });
        goBack();
      } catch (e) {
        toast({ message: (e as Error).message });
      }
      return;
    }
    const all = parseCsv(text);
    if (all.length < 2) return toast({ message: s.notCsv });
    const [header, ...rows] = all;
    const saved = savedMapping(db, header);
    const cols = saved?.mapping.columns ?? guessMapping(header);
    setFile({ name: asset.name, header, rows });
    setPreset(saved?.name ?? null);
    setPresetName(saved?.name ?? asset.name.replace(/\.[^.]+$/, ''));
    setColumns(cols);
    const dateCol = cols.indexOf('date');
    setDateFormat(saved?.mapping.dateFormat ?? (dateCol >= 0 ? (dateFormatsFor(rows.map((r) => r[dateCol] ?? ''))[0] ?? 'ymd') : 'ymd'));
    setStep('map');
  };

  const mapping = { columns, dateFormat };
  const dateCol = columns.indexOf('date');
  const formats = file && dateCol >= 0 ? dateFormatsFor(file.rows.map((r) => r[dateCol] ?? '')) : [];
  const mappingOk = dateCol >= 0 && (columns.includes('amount') || columns.includes('debit') || columns.includes('credit'));

  const toConfirm = () => {
    if (!file || !accountId) return;
    const p = previewImport(db, { accountId, rows: file.rows, mapping });
    setPreview(p);
    setDecisions(Object.fromEntries(p.map((r) => [r.line, r.error || r.duplicateOf ? 'skip' : 'import'])));
    setStep('confirm');
  };

  const chosen = preview.filter((r) => decisions[r.line] === 'import' && !r.error);
  const shift = accountId && step === 'confirm' ? openingShift(db, accountId, chosen) : null;

  if (step === 'pick') {
    return (
      <Screen>
        <Header title={s.title} onBack={goBack} />
        <Text style={[styles.h, { color: colors.ink }]}>{s.pickTitle}</Text>
        {(
          [
            ['csv', s.csvTitle, s.csvDetail, 'sort'],
            ['json', s.jsonTitle, s.jsonDetail, 'document'],
          ] as const
        ).map(([kind, title, detail, icon]) => (
          <Pressable key={kind} onPress={() => void pick(kind)} accessibilityRole="button">
            <Card style={styles.option}>
              <Icon name={icon} size={20} color={colors.accent} strokeWidth={1.8} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
                <Text style={[styles.small, { color: colors.inkMuted }]}>{detail}</Text>
              </View>
              <Icon name="forward" size={13} color={colors.inkMuted} strokeWidth={2.2} />
            </Card>
          </Pressable>
        ))}
      </Screen>
    );
  }

  if (step === 'map' && file) {
    return (
      <Screen>
        <Header title={s.mapTitle} subtitle={s.detected(file.name, file.header.length, file.rows.length)} onBack={() => setStep('pick')} />
        <Text style={[styles.small, { color: colors.inkSecondary }]}>{s.mapBody}</Text>
        {preset ? <Note tone="teal" icon="tick">{s.recognised(preset)}</Note> : null}
        <SelectorRow label={s.into} value={account ? `${account.name} · ${account.currency}` : s.pickAccount} onPress={() => setSheet({ kind: 'account' })} />
        {file.header.map((h, i) => (
          <SelectorRow key={i} label={s.column(letter(i), h)} value={`→ ${s.fields[columns[i] ?? 'ignore']}`} onPress={() => setSheet({ kind: 'column', index: i })} />
        ))}
        {dateCol >= 0 ? (
          formats.length === 0 ? (
            <Note tone="red">{s.noDateFormat}</Note>
          ) : formats.length > 1 ? (
            <SelectorRow label={s.dateFormat} value={s.dateFormats[dateFormat]} onPress={() => setSheet({ kind: 'date' })} />
          ) : null
        ) : null}
        {!mappingOk ? <Note tone="amber">{s.needDateAmount}</Note> : null}
        <Card style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
          {file.rows.slice(0, 4).map((r, i) => (
            <Text key={i} style={[styles.mono, { color: colors.inkSecondary }]} numberOfLines={1}>
              {r.join('  ·  ')}
            </Text>
          ))}
          <Text style={[styles.small, { color: colors.inkMuted }]}>{s.showing(Math.min(4, file.rows.length), file.rows.length)}</Text>
        </Card>
        {!preset ? <Field label={s.presetName} value={presetName} onChangeText={setPresetName} /> : null}
        <Button label={s.review(file.rows.length)} disabled={!accountId || !mappingOk || formats.length === 0} onPress={toConfirm} />
        <PickerSheet visible={sheet?.kind === 'account'} title={s.pickAccount} sections={accountSections} selectedId={accountId} onSelect={setAccountId} onClose={() => setSheet(null)} />
        <PickerSheet
          visible={sheet?.kind === 'column'}
          title={sheet?.kind === 'column' ? s.column(letter(sheet.index), file.header[sheet.index]) : ''}
          sections={[{ items: FIELDS.map((f) => ({ id: f, title: s.fields[f] })) }]}
          selectedId={sheet?.kind === 'column' ? columns[sheet.index] : null}
          onSelect={(f) => {
            if (sheet?.kind !== 'column') return;
            const next = columns.map((c, j) => (j === sheet.index ? (f as ColumnField) : c === f && f !== 'ignore' ? 'ignore' : c));
            setColumns(next);
            const dc = next.indexOf('date');
            if (dc >= 0) setDateFormat(dateFormatsFor(file.rows.map((r) => r[dc] ?? ''))[0] ?? 'ymd');
          }}
          onClose={() => setSheet(null)}
        />
        <PickerSheet
          visible={sheet?.kind === 'date'}
          title={s.dateFormat}
          sections={[{ items: formats.map((f) => ({ id: f, title: s.dateFormats[f] })) }]}
          selectedId={dateFormat}
          onSelect={(f) => setDateFormat(f as DateFormat)}
          onClose={() => setSheet(null)}
        />
      </Screen>
    );
  }

  const editing = sheet?.kind === 'category' ? preview.find((r) => r.line === sheet.line) : undefined;
  return (
    <Screen>
      <Header title={s.confirmTitle} onBack={() => setStep('map')} />
      <Text style={[styles.small, { color: colors.inkSecondary }]}>{s.confirmBody(chosen.length, preview.length)}</Text>
      {shift && account ? (
        <Note tone="amber" icon="calendar">
          {parts(s.opening(formatShortDate(shift.from.date), formatShortDate(shift.to.date), <Money key="m" value={shift.to.amount} currency={account.currency} style={{ fontFamily: fonts.monoSemiBold, fontSize: 12 }} />))}
        </Note>
      ) : null}
      {preview.map((r) => {
        if (r.error) return <Text key={r.line} style={[styles.small, { color: colors.expense }]}>{s.badRow(r.line, r.error === 'date' ? 'date' : 'amount')}</Text>;
        const skip = decisions[r.line] === 'skip';
        const set = (d: Decision) => setDecisions((x) => ({ ...x, [r.line]: d }));
        return (
          <Card key={r.line} style={[styles.row, skip && { opacity: 0.55 }, r.duplicateOf && !skip ? { borderColor: colors.warning, borderWidth: 1 } : null]}>
            <View style={styles.rowTop}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.ink }]} numberOfLines={1}>
                  {r.categoryId ? catNames.get(r.categoryId) : s.uncategorized}
                </Text>
                <Text style={[styles.small, { color: colors.inkMuted }]} numberOfLines={1}>
                  {formatShortDate(r.date!)} · {r.notes}
                </Text>
              </View>
              {account ? <Money value={r.amount!} currency={account.currency} sign="always" allowCompact={false} style={[styles.amount, { color: dec(r.amount!).isNegative() ? colors.expense : colors.income }]} /> : null}
            </View>
            {r.duplicateOf ? (
              <>
                <Text style={[styles.small, { color: colors.warning }]}>
                  {s.duplicate} · {s.duplicateDetail}
                </Text>
                <View style={styles.actions}>
                  <LinkButton label={skip ? s.importAnyway : s.skipDuplicate} onPress={() => set(skip ? 'import' : 'skip')} />
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.small, { color: skip ? colors.inkMuted : r.categoryId ? colors.income : colors.inkSecondary }]}>{skip ? s.skipped : r.categoryId ? s.matched : s.noCategory}</Text>
                <View style={styles.actions}>
                  {!skip ? <LinkButton label={s.setCategory} onPress={() => setSheet({ kind: 'category', line: r.line })} /> : null}
                  <LinkButton label={skip ? s.undoSkip : s.skipRow} onPress={() => set(skip ? 'import' : 'skip')} />
                </View>
              </>
            )}
          </Card>
        );
      })}
      <Button
        label={s.importRows(chosen.length)}
        disabled={busy || !accountId}
        onPress={() => {
          if (!file || !accountId) return;
          setBusy(true);
          try {
            const r = commitImport(db, { accountId, rows: chosen, header: file.header, mapping, presetName: preset ?? (presetName.trim() || file.name) });
            toast({ message: s.imported(r.added) });
            router.dismissTo('/');
          } catch (e) {
            toast({ message: (e as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      />
      <CategoryPicker
        visible={!!editing}
        kind={editing && dec(editing.amount ?? '0').isNegative() ? 'expense' : 'income'}
        selectedId={editing?.categoryId ?? null}
        onSelect={(id) => setPreview((p) => p.map((r) => (r.line === editing?.line ? { ...r, categoryId: id, categoryFrom: null } : r)))}
        onClose={() => setSheet(null)}
      />
    </Screen>
  );
}

function CategoryPicker({ visible, kind, selectedId, onSelect, onClose }: { visible: boolean; kind: 'expense' | 'income'; selectedId: string | null; onSelect: (id: string) => void; onClose: () => void }) {
  const sections = useCategorySections(kind);
  return <PickerSheet visible={visible} title={strings.dataImport.setCategory} sections={sections} selectedId={selectedId} onSelect={onSelect} onClose={onClose} />;
}

const styles = StyleSheet.create({
  h: { fontFamily: fonts.serif, fontSize: 19 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
  mono: { fontFamily: fonts.mono, fontSize: 11.5, paddingVertical: 4 },
  row: { padding: 14, gap: 4, borderRadius: radius.field },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  amount: { fontFamily: fonts.monoSemiBold, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 18 },
});
