import { isNull } from 'drizzle-orm';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Money } from '@/components/Money';
import { AddPeopleSheet } from '@/components/sheets/AddPeopleSheet';
import { Initials } from '@/components/sheets/pickers';
import { Button, Card, Header, IconButton, LinkButton, Segmented } from '@/components/ui';
import { equalShares, percentShares, type SplitDraft, type SplitMode } from '@/data/splits';
import { people } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { Decimal, dec, parseTypedAmount, toDecimalString, toTypedText } from '@/lib/money';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { fonts, radius, useTheme } from '@/theme';

interface Row {
  personId: string | null;
  /** Amounts mode: typed amount. */
  amountText: string;
  /** Percent mode: typed percent. */
  percentText: string;
  treat: boolean;
}

export interface SplitResult {
  split: SplitDraft;
  /** Null: you paid (from your account). */
  payerId: string | null;
}

/**
 * Split with people (Spec §9c). "I paid": the whole bill left your account and
 * others' shares are owed to you (a Treat owes nothing). "Someone else paid":
 * only your share becomes a debt, to the payer. Remaining to assign must reach 0.
 */
export function SplitEditor({
  visible,
  initial,
  initialPayerId,
  iPaid,
  someonePaid,
  onSave,
  onRemove,
  onClose,
}: {
  visible: boolean;
  initial: SplitDraft | null;
  initialPayerId: string | null;
  /** What left your account, in its currency (null until an account and amount are set). */
  iPaid: { total: string | null; currency: string; accountName: string | null };
  /** The bill as typed, when someone else paid. */
  someonePaid: { total: string | null; currency: string };
  onSave: (result: SplitResult) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const s = strings.split;
  const { colors } = useTheme();
  const { numberFormat } = useSettings();
  const names = useLive((d) => new Map(d.select().from(people).where(isNull(people.archivedAt)).all().map((p) => [p.id, p.name])));
  const [shownFor, setShownFor] = useState(false);
  const [payerId, setPayerId] = useState<string | null>(initialPayerId);
  const [whoPaid, setWhoPaid] = useState<'me' | 'other'>(initialPayerId ? 'other' : 'me');
  const [mode, setMode] = useState<SplitMode>(initial?.mode ?? 'equal');
  const [rows, setRows] = useState<Row[]>([]);
  const [sheet, setSheet] = useState<'add' | 'payer' | null>(null);

  // Fresh state each time it opens, from the form's split.
  if (visible !== shownFor) {
    setShownFor(visible);
    if (visible) {
      setPayerId(initialPayerId);
      setWhoPaid(initialPayerId ? 'other' : 'me');
      setMode(initial?.mode ?? 'equal');
      setRows(
        initial
          ? initial.shares.map((sh) => ({ personId: sh.personId, amountText: toTypedText(sh.amount, numberFormat), percentText: toTypedText(sh.percent ?? '', numberFormat), treat: !!sh.treat }))
          : [{ personId: null, amountText: '', percentText: '', treat: false }, ...(initialPayerId ? [{ personId: initialPayerId, amountText: '', percentText: '', treat: false }] : [])],
      );
    }
  }

  const other = whoPaid === 'other';
  const { total, currency } = other ? someonePaid : iPaid;
  const payerName = payerId ? (names.get(payerId) ?? '') : null;

  // Each row's amount for the current mode.
  const amounts: (string | null)[] = (() => {
    if (!total) return rows.map(() => null);
    if (mode === 'equal') return equalShares(total, rows.length, currency);
    if (mode === 'percent') {
      const pcts = rows.map((r) => parseTypedAmount(r.percentText, numberFormat) ?? '0');
      return percentShares(total, pcts, currency);
    }
    return rows.map((r) => parseTypedAmount(r.amountText, numberFormat));
  })();
  const remaining =
    mode === 'percent'
      ? toDecimalString(rows.reduce((left, r) => left.minus(dec(parseTypedAmount(r.percentText, numberFormat) ?? '0')), new Decimal(100)))
      : total
        ? toDecimalString(amounts.reduce((left, a) => left.minus(dec(a ?? '0')), dec(total)))
        : null;
  const hasOthers = rows.some((r) => r.personId !== null);
  const canSave = !!total && hasOthers && remaining !== null && dec(remaining).isZero() && amounts.every((a) => a !== null) && (!other || !!payerId);

  const update = (i: number, change: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const setPayer = (id: string) => {
    setPayerId(id);
    setWhoPaid('other');
    // The payer is part of the split.
    setRows((rs) => (rs.some((r) => r.personId === id) ? rs : [...rs, { personId: id, amountText: '', percentText: '', treat: false }]));
  };
  const save = () => {
    if (!canSave) return;
    onSave({
      payerId: other ? payerId : null,
      split: {
        mode,
        shares: rows.map((r, i) => ({
          personId: r.personId,
          amount: amounts[i]!,
          percent: mode === 'percent' ? (parseTypedAmount(r.percentText, numberFormat) ?? '0') : null,
          treat: !other && r.personId !== null && r.treat,
        })),
      },
    });
  };

  const rowDetail = (r: Row): string => {
    if (r.personId === null) return other ? s.youOwe(payerName ?? '') : s.yourShare;
    if (other) return r.personId === payerId ? s.payerRow : s.notTracked(payerName ?? '');
    return r.treat ? s.treated : s.owesYou;
  };
  const rowColor = (r: Row): string => {
    if (r.personId === null) return other ? colors.expense : colors.ink;
    if (other) return colors.inkMuted;
    return r.treat ? colors.inkMuted : colors.income;
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Header title={s.title} onBack={onClose} backIcon="close" actions={<IconButton icon="tick" filled label={s.save} onPress={save} disabled={!canSave} />} />

          <View>
            <Text style={[styles.label, { color: colors.inkMuted }]}>{s.whoPaid}</Text>
            <Segmented
              options={[
                { value: 'me', label: s.iPaid },
                { value: 'other', label: s.someoneElse },
              ]}
              value={whoPaid}
              onChange={(v) => {
                setWhoPaid(v);
                if (v === 'other' && !payerId) setSheet('payer');
              }}
            />
          </View>

          {other ? (
            <>
              <Pressable onPress={() => setSheet('payer')} style={[styles.selRow, { backgroundColor: colors.filled }]} accessibilityRole="button">
                {payerName ? <Initials name={payerName} size={26} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.selLabel, { color: colors.inkMuted }]}>{s.paidBy}</Text>
                  <Text style={[styles.selValue, { color: payerName ? colors.ink : colors.inkMuted }]}>{payerName ?? s.pickPayer}</Text>
                </View>
              </Pressable>
              {payerName ? <Text style={[styles.hint, { color: colors.inkMuted, marginTop: -6 }]}>{s.payerNote(payerName)}</Text> : null}
            </>
          ) : null}

          <Card style={styles.total}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.totalLabel, { color: colors.inkMuted }]}>{other ? s.totalPaidBy(payerName ?? '…') : s.totalYouPaid}</Text>
              {!other && iPaid.accountName ? <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.chargedTo(iPaid.accountName, currency)}</Text> : null}
            </View>
            {total ? <Money value={total} currency={currency} allowCompact={false} style={styles.totalValue} /> : <Text style={[styles.hint, { color: colors.warning }]}>{other ? s.needAmount : iPaid.accountName ? s.needAmount : s.needAccount}</Text>}
          </Card>

          <Segmented
            options={(['equal', 'amounts', 'percent'] as const).map((m) => ({ value: m, label: s.modes[m] }))}
            value={mode}
            onChange={(m) => {
              // Start the new mode from the current shares.
              if (m === 'amounts') setRows((rs) => rs.map((r, i) => ({ ...r, amountText: amounts[i] ? toTypedText(amounts[i], numberFormat) : r.amountText })));
              setMode(m);
            }}
          />
          <Text style={[styles.hint, { color: colors.inkMuted }]}>{s.modesHint(other ? payerName : null, currency)}</Text>

          <View>
            <Text style={[styles.label, { color: colors.inkMuted }]}>{s.between}</Text>
            <Card style={{ overflow: 'hidden' }}>
              {rows.map((r, i) => {
                const name = r.personId === null ? s.you : (names.get(r.personId) ?? '');
                const removable = r.personId !== null && r.personId !== payerId;
                return (
                  <View key={r.personId ?? 'you'} style={[styles.prow, i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }, other && r.personId !== null && r.personId !== payerId && { opacity: 0.6 }]}>
                    {r.personId === null ? (
                      <View style={[styles.youChip, { backgroundColor: colors.accentSoft }]}>
                        <Text style={[styles.youText, { color: colors.accent }]}>{s.you}</Text>
                      </View>
                    ) : (
                      <Initials name={name} size={32} />
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.pname, { color: colors.ink }]} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={[styles.pdetail, { color: colors.inkMuted }]} numberOfLines={2}>
                        {rowDetail(r)}
                      </Text>
                      {removable ? (
                        <Text onPress={() => setRows((rs) => rs.filter((_, j) => j !== i))} accessibilityRole="button" style={[styles.remove, { color: colors.accent }]}>
                          {s.remove}
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 5 }}>
                      {mode === 'amounts' ? (
                        <TextInput
                          value={r.amountText}
                          onChangeText={(t) => update(i, { amountText: t })}
                          keyboardType="numeric"
                          placeholder="0.00"
                          placeholderTextColor={colors.inkMuted}
                          style={[styles.input, { backgroundColor: colors.filled, color: colors.ink }]}
                        />
                      ) : mode === 'percent' ? (
                        <View style={styles.pctRow}>
                          <TextInput
                            value={r.percentText}
                            onChangeText={(t) => update(i, { percentText: t })}
                            keyboardType="numeric"
                            placeholder="0"
                            placeholderTextColor={colors.inkMuted}
                            style={[styles.input, styles.pctInput, { backgroundColor: colors.filled, color: colors.ink }]}
                          />
                          <Text style={[styles.pdetail, { color: colors.inkMuted }]}>%</Text>
                        </View>
                      ) : null}
                      {mode !== 'amounts' && amounts[i] ? (
                        <Money
                          value={amounts[i]!}
                          currency={currency}
                          allowCompact={false}
                          sign={!other && r.personId !== null && !r.treat ? 'always' : 'auto'}
                          style={[styles.pamount, { color: rowColor(r) }]}
                        />
                      ) : null}
                      {!other && r.personId !== null ? (
                        <View style={styles.treat}>
                          <Text style={[styles.treatLabel, { color: colors.inkSecondary }]}>{s.treat}</Text>
                          <Switch
                            value={r.treat}
                            onValueChange={(v) => update(i, { treat: v })}
                            trackColor={{ false: colors.border, true: colors.accentSoft }}
                            thumbColor={r.treat ? colors.accent : colors.surface}
                          />
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </Card>
            <LinkButton label={s.addPerson} onPress={() => setSheet('add')} />
          </View>

          <View style={styles.remaining}>
            <Text style={[styles.remainingLabel, { color: colors.ink }]}>{s.remaining}</Text>
            {remaining === null ? null : mode === 'percent' ? (
              <Text style={[styles.remainingValue, { color: dec(remaining).isZero() ? colors.income : colors.warning }]}>{toTypedText(remaining, numberFormat)}%</Text>
            ) : (
              <Money value={remaining} currency={currency} allowCompact={false} style={[styles.remainingValue, { color: dec(remaining).isZero() ? colors.income : colors.warning }]} />
            )}
          </View>

          <Text style={[styles.hint, { color: colors.inkMuted, fontSize: 11.5, lineHeight: 17 }]}>{other ? s.explainSomeone(payerName ?? '…') : s.explainIPaid}</Text>

          <Button label={s.save} disabled={!canSave} onPress={save} />
          {initial ? <LinkButton danger label={s.removeSplit} onPress={onRemove} /> : null}
        </ScrollView>

        <AddPeopleSheet
          visible={sheet === 'add'}
          already={rows.map((r) => r.personId).filter((x): x is string => !!x)}
          onAdd={(ids) => setRows((rs) => [...rs, ...ids.map((id) => ({ personId: id, amountText: '', percentText: '', treat: false }))])}
          onClose={() => setSheet(null)}
        />
        <AddPeopleSheet
          visible={sheet === 'payer'}
          title={s.pickPayer}
          single
          onAdd={([id]) => setPayer(id)}
          onClose={() => {
            setSheet(null);
            if (!payerId) setWhoPaid('me');
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}


const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, gap: 13 },
  label: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42, marginBottom: 6 },
  selRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 10 },
  selLabel: { fontFamily: fonts.sansBold, fontSize: 9.5, letterSpacing: 0.38 },
  selValue: { fontFamily: fonts.sansSemiBold, fontSize: 13.5 },
  hint: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 15, paddingHorizontal: 2 },
  total: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13 },
  totalLabel: { fontFamily: fonts.sans, fontSize: 12.5 },
  totalValue: { fontFamily: fonts.monoSemiBold, fontSize: 17 },
  prow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 11 },
  youChip: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  youText: { fontFamily: fonts.sansBold, fontSize: 11 },
  remove: { fontFamily: fonts.sansBold, fontSize: 11.5, marginTop: 4, alignSelf: 'flex-start' },
  pname: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  pdetail: { fontFamily: fonts.sans, fontSize: 10.5 },
  pamount: { fontFamily: fonts.monoSemiBold, fontSize: 14.5 },
  input: { fontFamily: fonts.mono, fontSize: 14, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6, minWidth: 96, textAlign: 'right' },
  pctRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pctInput: { minWidth: 60 },
  treat: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  treatLabel: { fontFamily: fonts.sansBold, fontSize: 10.5 },
  remaining: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  remainingLabel: { fontFamily: fonts.sansBold, fontSize: 12.5 },
  remainingValue: { fontFamily: fonts.monoSemiBold, fontSize: 13.5 },
});
