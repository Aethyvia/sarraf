import { asc, isNotNull } from 'drizzle-orm';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { CurrencySheet } from '@/components/sheets/CurrencySheet';
import { IconColorSheet } from '@/components/sheets/IconColorSheet';
import { BottomSheet, Button, Field, Header, Hint, IconButton, IconChip, Screen, SelectorRow, SheetOption } from '@/components/ui';
import { createAccount, defaultAccountLook, updateAccount, type Account } from '@/data/accounts';
import { db } from '@/db/client';
import { accounts } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { getCurrency, parseTypedAmount } from '@/lib/money';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { usePlan } from '@/state/plan';
import { useSettings } from '@/state/settings';
import { fonts, radius, useTheme } from '@/theme';

/** Add account (no account) or Edit account. The currency is fixed once created. */
export function AccountForm({ account }: { account?: Account }) {
  const s = strings.accounts;
  const settings = useSettings();
  const plan = usePlan();
  const { colors } = useTheme();
  const [name, setName] = useState(account?.name ?? '');
  // Settings → Default currency is pre-selected for new accounts (Schema: settings.default_currency).
  const [currency, setCurrency] = useState<string | null>(account?.currency ?? settings.defaultCurrency);
  const [institution, setInstitution] = useState<string | null>(account?.institution ?? null);
  const [balance, setBalance] = useState('');
  const [look, setLook] = useState<{ icon: string; color: string } | null>(
    account ? { icon: account.icon, color: account.color } : null,
  );
  const [sheet, setSheet] = useState<'icon' | 'currency' | 'institution' | null>(null);
  const action = useAction({ itemName: name.trim() || null, onArchiveForLimit: () => router.replace('/accounts') });

  const picked = defaultAccountLook(name, institution);
  const shown = look ?? picked;
  const balanceValue = balance.trim() ? parseTypedAmount(balance, settings.numberFormat) : null;
  const balanceInvalid = balance.trim() !== '' && balanceValue === null;
  const canSave = name.trim() !== '' && currency !== null && !balanceInvalid;

  const save = () => {
    if (!canSave) return;
    const ok = action.run(() => {
      if (account) {
        updateAccount(db, account.id, { name, institution, icon: shown.icon, color: shown.color });
      } else {
        createAccount(db, { name, currency: currency!, institution, icon: shown.icon, color: shown.color, currentBalance: balanceValue }, plan);
      }
      return true;
    });
    if (ok) router.back();
  };

  return (
    <Screen>
      <Header
        title={account ? s.edit : s.add}
        onBack={() => router.back()}
        backIcon="close"
        actions={<IconButton icon="tick" filled label={strings.common.save} onPress={save} disabled={!canSave} />}
      />
      {action.ui}

      <SelectorRow
        chevron="forward"
        leading={<IconChip icon={shown.icon} color={shown.color} size={44} />}
        value={s.iconColor}
        label={undefined}
        onPress={() => setSheet('icon')}
      />
      <Hint>
        {look ? s.iconColorCurrent(strings.iconPicker.colors[shown.color] ?? shown.color, shown.icon) : s.iconColorPicked(strings.iconPicker.colors[shown.color] ?? shown.color)}
      </Hint>

      <Field label={s.name} value={name} onChangeText={setName} placeholder={s.namePlaceholder} autoCapitalize="words" />

      <SelectorRow
        label={s.currency}
        value={currency ? `${currency} — ${getCurrency(currency).name}` : s.chooseCurrency}
        onPress={() => setSheet('currency')}
        locked={!!account}
      />
      <Hint>{account ? s.currencyLocked : s.currencyHint}</Hint>

      {!account ? (
        <>
          <View style={[styles.amountBox, { backgroundColor: colors.filled }, balanceInvalid && { borderColor: colors.expense, borderWidth: 1.5 }]}>
            <Text style={[styles.amountLabel, { color: colors.inkMuted }]}>
              {s.currentBalance.toUpperCase()} ({strings.common.optional.toUpperCase()})
            </Text>
            <TextInput
              value={balance}
              onChangeText={setBalance}
              placeholder="0.00"
              placeholderTextColor={colors.inkMuted}
              keyboardType="numeric"
              style={[styles.amountInput, { color: colors.ink }]}
            />
          </View>
          <Hint>{s.currentBalanceHint}</Hint>
        </>
      ) : null}

      <SelectorRow label={`${s.institution} (${strings.common.optional})`} value={institution ?? strings.common.none} onPress={() => setSheet('institution')} />
      <Hint>{s.institutionHint}</Hint>

      {!account ? <Text style={[styles.saveHint, { color: colors.inkMuted }]}>{s.saveHint}</Text> : null}
      <Button label={account ? strings.common.save : s.save} onPress={save} disabled={!canSave} />

      <IconColorSheet
        visible={sheet === 'icon'}
        title={name.trim() || s.add}
        icon={shown.icon}
        color={shown.color}
        defaults={picked}
        onSave={(l) => setLook(l.icon === picked.icon && l.color === picked.color ? null : l)}
        onClose={() => setSheet(null)}
      />
      <CurrencySheet
        visible={sheet === 'currency'}
        selected={currency ?? settings.defaultCurrency}
        onSelect={setCurrency}
        onClose={() => setSheet(null)}
      />
      <InstitutionSheet
        visible={sheet === 'institution'}
        selected={institution}
        onSelect={setInstitution}
        onClose={() => setSheet(null)}
      />
    </Screen>
  );
}

/** None, the institutions already in use, or a new one. */
function InstitutionSheet({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: string | null;
  onSelect: (value: string | null) => void;
  onClose: () => void;
}) {
  const s = strings.accounts;
  const [draft, setDraft] = useState('');
  const known = useLive((d) => [
    ...new Set(
      d
        .select({ i: accounts.institution })
        .from(accounts)
        .where(isNotNull(accounts.institution))
        .orderBy(asc(accounts.institution))
        .all()
        .map((r) => r.i!),
    ),
  ]);
  const pick = (value: string | null) => {
    onSelect(value);
    setDraft('');
    onClose();
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title={s.institution}>
      <SheetOption title={strings.common.none} selected={selected === null} onPress={() => pick(null)} />
      {known.map((i) => (
        <SheetOption key={i} title={i} selected={selected === i} onPress={() => pick(i)} />
      ))}
      <View style={{ gap: 10, marginTop: 14 }}>
        <Field label={s.newInstitution} value={draft} onChangeText={setDraft} placeholder={s.institutionPlaceholder} autoCapitalize="words" />
        <Button label={strings.common.add} disabled={!draft.trim()} onPress={() => pick(draft.trim())} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  amountBox: { borderRadius: radius.field, paddingHorizontal: 13, paddingTop: 10, paddingBottom: 4 },
  amountLabel: { fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.4 },
  amountInput: { fontFamily: fonts.mono, fontSize: 15, paddingVertical: 4 },
  saveHint: { fontFamily: fonts.sans, fontSize: 11, textAlign: 'center', marginTop: 8, marginBottom: -6 },
});
