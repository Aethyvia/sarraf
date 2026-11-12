import { eq, isNull } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';

import { AmountBox, ConversionTrio, type TrioSlot } from '@/components/AmountBox';
import { KeypadScreen } from '@/components/KeypadScreen';
import { Money } from '@/components/Money';
import { PickerSheet } from '@/components/sheets/PickerSheet';
import { Field, Header, Hint, IconButton, IconChip, Segmented, SelectorRow, SheetOption } from '@/components/ui';
import { vsMarketPercent } from '@/data/amounts';
import { markSettled, offsetBalances, personBalances, settleByPayment } from '@/data/owing';
import { marketRate } from '@/data/rates';
import { db } from '@/db/client';
import { accounts, people } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { expressionValue, pressKey, type CalcKey } from '@/lib/calc';
import { today as todayDate } from '@/lib/dates';
import { dec, getCurrency, toDecimalString } from '@/lib/money';
import { trimRate } from '@/components/transaction/parts';
import { useAction } from '@/state/actions';
import { rateFromYFirst, workOut } from '@/state/conversion';
import { useLive } from '@/state/live';
import { goBack } from '@/state/nav';
import { useToast } from '@/state/toast';
import { RATE_MAX_DECIMALS } from '@/state/transaction-form';
import { fonts, useTheme } from '@/theme';

type How = 'outside' | 'paid' | 'offset';

/**
 * Settle up with a person (Owner, Nov 12): a full page. Which balance (a
 * dropdown, any number of currencies), how it was settled (three cards), then
 * the details; the amounts stay docked above Sarraf's keypad and ✓ saves.
 * Paid into an account works in the balance's own currency (one amount) or
 * any other (settles · rate · paid, tap the one you know).
 */
export default function SettleUpScreen() {
  const s = strings.settle;
  const u = strings.settleUp;
  const { id, currency: initialCurrency } = useLocalSearchParams<{ id: string; currency?: string }>();
  const { colors } = useTheme();
  const toast = useToast();
  const action = useAction();
  const today = todayDate();

  const data = useLive(
    (d) => {
      const person = d.select().from(people).where(eq(people.id, id)).get();
      if (!person) return null;
      const balances = [...personBalances(d, id, today).entries()].filter(([, b]) => !dec(b).isZero()).map(([currency, balance]) => ({ currency, balance }));
      const accs = d.select().from(accounts).where(isNull(accounts.archivedAt)).orderBy(accounts.rank).all();
      return { person, balances, accounts: accs };
    },
    [id],
  );

  const [currency, setCurrency] = useState<string | null>(initialCurrency ?? null);
  const [how, setHow] = useState<How>('outside');
  const [part, setPart] = useState(false);
  const [xText, setXText] = useState('');
  const [rateText, setRateText] = useState<string | null>(null);
  const [yText, setYText] = useState('');
  const [known, setKnown] = useState<'rate' | 'y'>('y');
  const [focus, setFocus] = useState<TrioSlot>('amount');
  const [paidCurrency, setPaidCurrency] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [againstCurrency, setAgainstCurrency] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sheet, setSheet] = useState<'balance' | 'account' | 'paidCurrency' | 'against' | null>(null);

  const balances = data?.balances ?? [];
  const chosen = balances.find((b) => b.currency === currency) ?? balances[0] ?? null;
  const owesYou = !!chosen && dec(chosen.balance).isPositive();
  const opposite = chosen ? balances.filter((b) => b.currency !== chosen.currency && dec(b.balance).isPositive() !== owesYou) : [];
  const against = opposite.find((b) => b.currency === againstCurrency) ?? opposite[0] ?? null;
  const accs = data?.accounts ?? [];
  // Paid into an account: the currency picks the accounts; it starts in the balance's own currency when you have one.
  const paidCur = paidCurrency ?? (chosen && accs.some((a) => a.currency === chosen.currency) ? chosen.currency : (accs[0]?.currency ?? null));
  const paidAccounts = accs.filter((a) => a.currency === paidCur);
  const account = paidAccounts.find((a) => a.id === accountId) ?? paidAccounts[0] ?? null;
  // The other side of the three numbers: what was paid (paid), or the other balance (offset).
  const curY = how === 'offset' ? (against?.currency ?? null) : how === 'paid' ? paidCur : null;
  const converts = !!chosen && !!curY && curY !== chosen.currency;
  const market = useLive((d) => (converts && chosen && curY ? marketRate(d, curY, chosen.currency) : null), [converts, chosen?.currency, curY]);

  if (!data || !chosen) {
    return (
      <KeypadScreen header={<Header title={u.title(data?.person.name ?? '')} onBack={goBack} backIcon="close" />} keypad={false} onKey={() => {}} amount={null}>
        <Hint>{u.nothingOwed}</Hint>
      </KeypadScreen>
    );
  }
  const { person } = data;
  const curX = chosen.currency;
  const full = toDecimalString(dec(chosen.balance).abs());
  const minorX = getCurrency(curX).minorUnits;
  const x = part ? expressionValue(xText, minorX) : full;
  const xValid = !!x && dec(x).gt(0) && dec(x).lte(dec(full));

  // X per Y at the market, and which way the rate reads (stronger currency first).
  const xPerY = market?.rate ?? null;
  const fromY = rateFromYFirst(xPerY);
  const marketShown = xPerY ? trimRate(fromY ? xPerY : toDecimalString(dec('1').dividedBy(dec(xPerY)))) : null;
  const rateExpr = rateText ?? (known === 'rate' ? (marketShown ?? '') : '');
  const typedRate = expressionValue(rateExpr, RATE_MAX_DECIMALS);
  const typedY = curY ? expressionValue(yText, getCurrency(curY).minorUnits) : null;
  const worked = converts && curY ? workOut({ x: xValid ? x : null, known, rate: typedRate, y: typedY, curY, rateFromY: fromY }) : { rate: null, y: null };
  const y = converts ? worked.y : x;
  const room = how === 'offset' && against ? toDecimalString(dec(against.balance).abs()) : null;
  const tooMuch = how === 'offset' && !!y && !!room && dec(y).gt(dec(room));

  const canSave =
    xValid &&
    (how === 'outside' ||
      (how === 'paid' && !!account && !!y && dec(y).gt(0)) ||
      (how === 'offset' && !!against && !!y && dec(y).gt(0) && !tooMuch));

  const moved = (b: string, by: string | null) => (by ? toDecimalString(dec(b).isPositive() ? dec(b).minus(dec(by)) : dec(b).plus(dec(by))) : b);
  const tone = (v: string) => (dec(v).isNegative() ? colors.expense : dec(v).isZero() ? colors.inkMuted : colors.income);
  const line = (label: string, value: string, cur: string, color?: string) => (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, { color: colors.inkSecondary }]}>{label}</Text>
      <Money value={value} currency={cur} sign={dec(value).isZero() ? 'auto' : 'always'} allowCompact={false} style={[styles.lineValue, { color: color ?? tone(value) }]} />
    </View>
  );

  const resetY = () => {
    setRateText(null);
    setYText('');
  };
  const changeHow = (h: How) => {
    setHow(h);
    resetY();
    // Paid: you usually know what was paid; against another balance: the rate you agreed.
    setKnown(h === 'offset' ? 'rate' : 'y');
    setFocus(h === 'outside' ? 'amount' : h === 'paid' ? 'counter' : 'rate');
  };
  const onKey = (key: CalcKey) => {
    Keyboard.dismiss();
    const slot: TrioSlot = converts ? focus : 'amount';
    if (slot === 'amount') {
      // Typing the amount makes it Part of it.
      if (!part) {
        setPart(true);
        setXText(pressKey('', key, minorX));
      } else setXText(pressKey(xText, key, minorX));
    } else if (slot === 'rate') setRateText(pressKey(rateExpr, key, RATE_MAX_DECIMALS));
    else if (curY) setYText(pressKey(yText, key, getCurrency(curY).minorUnits));
  };
  const onFocus = (slot: TrioSlot) => {
    Keyboard.dismiss();
    setFocus(slot);
    if (slot === 'rate' && known !== 'rate') {
      setKnown('rate');
      setRateText('');
    } else if (slot === 'counter' && known !== 'y') {
      setKnown('y');
      setYText('');
    }
  };
  const save = () => {
    if (!canSave || !x) return;
    const done =
      how === 'paid'
        ? action.run(() => settleByPayment(db, { personId: person.id, currency: curX, clears: x, accountId: account!.id, amount: y!, note }))
        : how === 'offset'
          ? action.run(() => offsetBalances(db, { personId: person.id, a: { currency: curX, amount: x }, b: { currency: against!.currency, amount: y! }, note }))
          : action.run(() => markSettled(db, { personId: person.id, currency: curX, amount: x, note }));
    if (done) {
      toast({ message: s.done });
      router.back();
    }
  };

  const balanceText = (b: { currency: string; balance: string }) => (dec(b.balance).isPositive() ? s.owesYou(b.currency, person.name) : s.youOwe(b.currency));
  const balanceValue = (b: { currency: string; balance: string }) => (
    <Text style={[styles.rowValue, { color: colors.ink }]} numberOfLines={1}>
      {balanceText(b)}{' '}
      <Money value={b.balance} currency={b.currency} sign="always" allowCompact={false} style={[styles.lineValue, { color: tone(b.balance) }]} />
    </Text>
  );
  const xLabel = (how === 'offset' ? (owesYou ? u.owesYouLabel(person.name) : u.youOweLabel(person.name)) : how === 'paid' ? u.settlesLabel(person.name, curX) : u.settleLabel).toUpperCase();

  // ── Docked above the keypad ──
  const xBox = (
    <AmountBox
      label={xLabel}
      expression={part ? xText : full}
      value={x}
      currency={curX}
      focused={!converts || focus === 'amount'}
      onFocus={() => onFocus('amount')}
      onBackspace={() => (part ? onKey('back') : (setPart(true), setXText('')))}
      onClear={() => (setPart(true), setXText(''))}
      onCurrency={how === 'paid' && !converts ? () => setSheet('paidCurrency') : undefined}
    />
  );
  const docked = (
    <>
      {converts && curY ? (
        <ConversionTrio
          amount={{ label: xLabel, currency: curX, expression: part ? xText : full, value: x }}
          rate={{
            from: fromY ? curY : curX,
            to: fromY ? curX : curY,
            expression: rateExpr,
            value: known === 'rate' ? typedRate : worked.rate,
            worked: known !== 'rate',
          }}
          counter={{
            label: (how === 'paid' ? u.paidLabel(account?.name ?? '') : u.fromOtherLabel(person.name, curY)).toUpperCase(),
            currency: curY,
            onCurrency: how === 'paid' ? () => setSheet('paidCurrency') : opposite.length > 1 ? () => setSheet('against') : undefined,
            expression: yText,
            value: y,
            worked: known !== 'y',
          }}
          focused={focus}
          onFocus={onFocus}
          onBackspace={() => onKey('back')}
          onClear={() => onKey('clear')}
          market={marketShown}
          onUseMarket={() => {
            setKnown('rate');
            setRateText(marketShown);
            setFocus('rate');
          }}
          vsMarket={(() => {
            const r = known === 'rate' ? typedRate : worked.rate;
            const pct = r && marketShown ? vsMarketPercent(r, marketShown) : null;
            return pct ? strings.add.vsMarket(pct) : null;
          })()}
        />
      ) : (
        xBox
      )}
      {xValid ? line(owesYou ? s.stillOwes(person.name) : s.youStillOwe, moved(chosen.balance, x), curX) : null}
      {how === 'offset' && against && y ? line(s.balanceAfter(person.name, against.currency), moved(against.balance, tooMuch ? null : y), against.currency) : null}
      {tooMuch && against ? <Text style={[styles.warn, { color: colors.expense }]}>{u.tooMuch(person.name, against.currency)}</Text> : null}
      {how === 'paid' && account && y ? line(owesYou ? s.accountUp(account.name) : s.accountDown(account.name), y, account.currency, owesYou ? colors.income : colors.expense) : null}
    </>
  );

  const hows: { value: How; title: string; detail: string }[] = [
    { value: 'outside', title: s.howOutside, detail: s.howOutsideDetail(person.name) },
    { value: 'paid', title: owesYou ? u.paidInto : u.paidFrom, detail: owesYou ? u.paidIntoDetail(person.name) : u.paidFromDetail(person.name) },
    ...(opposite.length
      ? [{ value: 'offset' as const, title: u.against, detail: owesYou ? s.howOffsetDetailYouOweThem(person.name, against!.currency) : s.howOffsetDetailTheyOweYou(person.name, against!.currency) }]
      : []),
  ];

  return (
    <KeypadScreen
      header={
        <>
          <Header title={u.title(person.name)} onBack={goBack} backIcon="close" actions={<IconButton icon="tick" filled label={strings.people.markSettled} onPress={save} disabled={!canSave} />} />
          {action.ui}
        </>
      }
      onKey={onKey}
      amount={docked}
    >
      <SelectorRow label={u.whichBalance} value={balanceValue(chosen)} onPress={balances.length > 1 ? () => setSheet('balance') : undefined} />
      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: colors.inkMuted }]}>{u.howTitle}</Text>
        {hows.map((h) => (
          <SheetOption key={h.value} title={h.title} detail={h.detail} selected={how === h.value} onPress={() => changeHow(h.value)} />
        ))}
      </View>
      <Segmented
        options={[
          { value: 'full', label: s.full },
          { value: 'part', label: s.part },
        ]}
        value={part ? 'part' : 'full'}
        onChange={(v) => {
          setPart(v === 'part');
          setXText('');
          setFocus('amount');
        }}
      />
      {how === 'paid' ? (
        <SelectorRow
          label={owesYou ? s.into : s.outOf}
          value={account?.name ?? s.pickAccount}
          leading={account ? <IconChip icon={account.icon} color={account.color} size={28} /> : undefined}
          onPress={() => setSheet('account')}
        />
      ) : null}
      {how === 'offset' && against ? <SelectorRow label={u.againstLabel} value={balanceValue(against)} onPress={opposite.length > 1 ? () => setSheet('against') : undefined} /> : null}
      <Field label={s.note.replace(' (OPTIONAL)', '')} optional value={note} onChangeText={setNote} placeholder={s.notePlaceholder} />
      <Hint>{how === 'paid' ? s.explainOther(person.name) : how === 'offset' ? s.explainOffset : s.explain(person.name)}</Hint>

      <PickerSheet
        visible={sheet === 'balance'}
        title={u.whichBalanceTitle}
        sections={[{ items: balances.map((b) => ({ id: b.currency, title: balanceText(b), trailing: <Money value={b.balance} currency={b.currency} sign="always" style={[styles.lineValue, { color: tone(b.balance) }]} /> })) }]}
        selectedId={chosen.currency}
        onSelect={(c) => {
          setCurrency(c);
          setPart(false);
          setXText('');
          setAgainstCurrency(null);
          resetY();
          if (how === 'offset') setHow('outside');
        }}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'against'}
        title={u.againstLabel}
        sections={[{ items: opposite.map((b) => ({ id: b.currency, title: balanceText(b), trailing: <Money value={b.balance} currency={b.currency} sign="always" style={[styles.lineValue, { color: tone(b.balance) }]} /> })) }]}
        selectedId={against?.currency ?? null}
        onSelect={(c) => {
          setAgainstCurrency(c);
          resetY();
        }}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'paidCurrency'}
        title={u.paidCurrencyTitle}
        sections={[{ items: [...new Set(accs.map((a) => a.currency))].map((c) => ({ id: c, title: c, detail: getCurrency(c).name })) }]}
        selectedId={paidCur}
        onSelect={(c) => {
          setPaidCurrency(c);
          setAccountId(null);
          resetY();
          setKnown('y');
          setFocus(c === curX ? 'amount' : 'counter');
        }}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'account'}
        title={owesYou ? u.intoTitle : u.outOfTitle}
        sections={[{ items: accs.map((a) => ({ id: a.id, title: a.name, detail: a.currency, leading: <IconChip icon={a.icon} color={a.color} size={30} /> })) }]}
        selectedId={account?.id ?? null}
        onSelect={(aid) => {
          const a = accs.find((x2) => x2.id === aid);
          if (!a) return;
          if (a.currency !== paidCur) {
            setPaidCurrency(a.currency);
            resetY();
            setKnown('y');
            setFocus(a.currency === curX ? 'amount' : 'counter');
          }
          setAccountId(aid);
        }}
        onClose={() => setSheet(null)}
      />
    </KeypadScreen>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.42 },
  rowValue: { fontFamily: fonts.sansSemiBold, fontSize: 14.5 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 4 },
  lineLabel: { fontFamily: fonts.sans, fontSize: 12, flex: 1 },
  lineValue: { fontFamily: fonts.monoSemiBold, fontSize: 12.5 },
  warn: { fontFamily: fonts.sans, fontSize: 12, paddingHorizontal: 4 },
});
