import { isNull } from 'drizzle-orm';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmountBox } from '@/components/AmountBox';
import { Keypad } from '@/components/Keypad';
import { Money } from '@/components/Money';
import { AddPeopleSheet } from '@/components/sheets/AddPeopleSheet';
import { Initials } from '@/components/sheets/pickers';
import { Card, Header, IconButton, LinkButton, Segmented } from '@/components/ui';
import { equalShares, leftoverToYou, percentShares, type SplitDraft, type SplitMode } from '@/data/splits';
import { people } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { expressionValue, pressKey, type CalcKey } from '@/lib/calc';
import { Decimal, dec, formatTyped, getCurrency, toDecimalString, toTypedText } from '@/lib/money';
import { useLive } from '@/state/live';
import { useSettings } from '@/state/settings';
import { fonts, radius, useTheme } from '@/theme';

interface Row {
  personId: string | null;
  /** Amounts mode: the amount as typed on the keypad. */
  amountText: string;
  /** Percent mode: the percent as typed on the keypad. */
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
 * only your share becomes a debt, to the payer. Shares are edited like Charges
 * (Owner, Nov 12): tap one, type it in the amount box above the keypad. Money
 * left to assign doesn't block saving; it's added to your share, with a warning.
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
  // The share the keypad is typing into (amounts and percent modes).
  const [sel, setSel] = useState<number | null>(null);

  // Fresh state each time it opens, from the form's split.
  if (visible !== shownFor) {
    setShownFor(visible);
    if (visible) {
      setPayerId(initialPayerId);
      setWhoPaid(initialPayerId ? 'other' : 'me');
      setMode(initial?.mode ?? 'equal');
      setRows(
        initial
          ? initial.shares.map((sh) => ({ personId: sh.personId, amountText: sh.amount, percentText: sh.percent ?? '', treat: !!sh.treat }))
          : [{ personId: null, amountText: '', percentText: '', treat: false }, ...(initialPayerId ? [{ personId: initialPayerId, amountText: '', percentText: '', treat: false }] : [])],
      );
      setSel(initial && initial.mode !== 'equal' ? 0 : null);
    }
  }

  const other = whoPaid === 'other';
  const { total, currency } = other ? someonePaid : iPaid;
  const payerName = payerId ? (names.get(payerId) ?? '') : null;
  const minor = getCurrency(currency).minorUnits;
  const pct = (r: Row) => expressionValue(r.percentText, 4) ?? '0';
  const youIndex = rows.findIndex((r) => r.personId === null);

  // Each row's amount for the current mode.
  const amounts: (string | null)[] = (() => {
    if (!total) return rows.map(() => null);
    if (mode === 'equal') return equalShares(total, rows.length, currency);
    if (mode === 'percent') {
      return percentShares(total, rows.map(pct), currency);
    }
    return rows.map((r) => (r.amountText ? expressionValue(r.amountText, minor) : '0'));
  })();
  const remaining =
    mode === 'percent'
      ? toDecimalString(rows.reduce((left, r) => left.minus(dec(pct(r))), new Decimal(100)))
      : total
        ? toDecimalString(amounts.reduce((left, a) => left.minus(dec(a ?? '0')), dec(total)))
        : null;
  const hasOthers = rows.some((r) => r.personId !== null);
  // What's left goes to your share on save; more than the total can't be saved.
  const leftover = remaining !== null && dec(remaining).gt(0) ? remaining : null;
  const canSave = !!total && hasOthers && remaining !== null && !dec(remaining).isNegative() && amounts.every((a) => a !== null) && (!other || !!payerId);

  const update = (i: number, change: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const setPayer = (id: string) => {
    setPayerId(id);
    setWhoPaid('other');
    // The payer is part of the split.
    setRows((rs) => (rs.some((r) => r.personId === id) ? rs : [...rs, { personId: id, amountText: '', percentText: '', treat: false }]));
  };
  const save = () => {
    if (!canSave || !total) return;
    const percents = mode === 'percent' ? (leftoverToYou(rows.map(pct), youIndex, '100') ?? rows.map(pct)) : null;
    const finalAmounts = percents ? percentShares(total, percents, currency) : mode === 'amounts' ? (leftoverToYou(amounts as string[], youIndex, total) ?? amounts) : amounts;
    onSave({
      payerId: other ? payerId : null,
      split: {
        mode,
        shares: rows.map((r, i) => ({
          personId: r.personId,
          amount: finalAmounts[i]!,
          percent: percents ? percents[i] : null,
          treat: !other && r.personId !== null && r.treat,
        })),
      },
    });
  };

  const typeKey = (key: CalcKey) => {
    if (sel === null) return;
    if (mode === 'amounts') update(sel, { amountText: pressKey(rows[sel].amountText, key, minor) });
    else update(sel, { percentText: pressKey(rows[sel].percentText, key, 4) });
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
              if (m === 'amounts') setRows((rs) => rs.map((r, i) => ({ ...r, amountText: amounts[i] ?? r.amountText })));
              setMode(m);
              setSel(m === 'equal' ? null : (sel ?? 0));
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
                      {mode !== 'equal' ? (
                        <Pressable
                          onPress={() => setSel(i)}
                          accessibilityRole="button"
                          accessibilityLabel={`${name} share`}
                          style={[styles.cell, { backgroundColor: sel === i ? colors.accentSoft : colors.filled, borderColor: sel === i ? colors.accent : 'transparent' }]}
                        >
                          <Text style={[styles.cellText, { color: colors.ink }]} numberOfLines={1}>
                            {mode === 'amounts'
                              ? r.amountText ? formatTyped(r.amountText, currency, numberFormat) : '0'
                              : `${r.percentText ? formatTyped(r.percentText, currency, numberFormat) : '0'}%`}
                          </Text>
                        </Pressable>
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
              <Money value={remaining} currency={currency} allowCompact={false} style={[styles.remainingValue, { color: dec(remaining).isZero() ? colors.income : dec(remaining).isNegative() ? colors.expense : colors.warning }]} />
            )}
          </View>
          {leftover ? (
            <Text style={[styles.hint, { color: colors.warning }]}>
              {mode === 'percent' ? s.leftoverPercent(toTypedText(leftover, numberFormat)) : s.leftoverAmount}
            </Text>
          ) : remaining !== null && dec(remaining).isNegative() ? (
            <Text style={[styles.hint, { color: colors.expense }]}>{s.overAssigned}</Text>
          ) : null}

          <Text style={[styles.hint, { color: colors.inkMuted, fontSize: 11.5, lineHeight: 17 }]}>{other ? s.explainSomeone(payerName ?? '…') : s.explainIPaid}</Text>

          {initial ? <LinkButton danger label={s.removeSplit} onPress={onRemove} /> : null}
        </ScrollView>

        {mode !== 'equal' && sel !== null && rows[sel] ? (
          <View style={styles.dock}>
            <AmountBox
              label={(rows[sel].personId === null ? s.yourShareLabel : s.theirShareLabel(names.get(rows[sel].personId!) ?? '')).toUpperCase()}
              expression={mode === 'amounts' ? rows[sel].amountText : rows[sel].percentText}
              value={mode === 'amounts' ? expressionValue(rows[sel].amountText, minor) : expressionValue(rows[sel].percentText, 4)}
              currency={currency}
              chipText={mode === 'percent' ? '%' : undefined}
              onBackspace={() => typeKey('back')}
              onClear={() => typeKey('clear')}
            />
            <Keypad onKey={typeKey} />
          </View>
        ) : null}

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
  cell: { borderRadius: 9, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 6, minWidth: 96, alignItems: 'flex-end' },
  cellText: { fontFamily: fonts.mono, fontSize: 14 },
  dock: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: 8 },
  treat: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  treatLabel: { fontFamily: fonts.sansBold, fontSize: 10.5 },
  remaining: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  remainingLabel: { fontFamily: fonts.sansBold, fontSize: 12.5 },
  remainingValue: { fontFamily: fonts.monoSemiBold, fontSize: 13.5 },
});
