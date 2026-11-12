import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { CurrencySheet } from '@/components/sheets/CurrencySheet';
import { BottomSheet, Button, Field, IconChip, LinkButton } from '@/components/ui';
import { FREE_LIMITS } from '@/data/limits';
import { ALSO_CHOICES, type SuggestedAccount } from '@/data/setup';
import { defaultAccountLook } from '@/data/accounts';
import { strings } from '@/i18n/strings';
import { getCurrency } from '@/lib/money';
import { fonts, radius, useTheme } from '@/theme';
import { StartPage, Note } from './StartPage';

/** Setup 1 of 4: the everyday currency (from the phone's region) and "I also earn or hold" chips. */
export function CurrencyStep({
  everyday,
  also,
  onChange,
  onBack,
  onNext,
  extra,
}: {
  everyday: string;
  also: string[];
  onChange: (everyday: string, also: string[]) => void;
  onBack: () => void;
  onNext: () => void;
  /** Under Continue, e.g. "Restore from Google Drive". */
  extra?: ReactNode;
}) {
  const s = strings.start;
  const { colors } = useTheme();
  const [picking, setPicking] = useState<'everyday' | 'more' | null>(null);
  const chips = [...new Set([...ALSO_CHOICES, ...also])].filter((c) => c !== everyday);
  const toggle = (c: string) => onChange(everyday, also.includes(c) ? also.filter((x) => x !== c) : [...also, c]);
  return (
    <StartPage
      onBack={onBack}
      step={1}
      title={s.currencyTitle}
      body={s.currencyBody}
      footer={
        <>
          <Button label={s.continue} onPress={onNext} />
          {extra}
        </>
      }
    >
      <Pressable onPress={() => setPicking('everyday')} style={[styles.select, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.lbl, { color: colors.inkMuted }]}>{s.everyday}</Text>
          <Text style={[styles.selectValue, { color: colors.ink }]}>
            {everyday} — {getCurrency(everyday).name}
          </Text>
        </View>
        <Icon name="down" size={13} color={colors.inkMuted} strokeWidth={2.2} />
      </Pressable>
      <View style={{ gap: 8 }}>
        <Text style={[styles.lbl, { color: colors.inkMuted }]}>{s.also}</Text>
        <View style={styles.chips}>
          {chips.map((c) => {
            const on = also.includes(c);
            return (
              <Pressable
                key={c}
                onPress={() => toggle(c)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={[styles.chip, on ? { backgroundColor: colors.accent } : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5 }]}
              >
                <Text style={[styles.chipText, { color: on ? colors.onAccent : colors.ink }]}>{c}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => setPicking('more')} style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5 }]}>
            <Text style={[styles.chipText, { color: colors.ink }]}>{s.more}</Text>
          </Pressable>
        </View>
      </View>
      <Text style={[styles.small, { color: colors.inkMuted }]}>{s.currencyNote}</Text>
      <CurrencySheet
        visible={picking !== null}
        selected={picking === 'everyday' ? everyday : null}
        onSelect={(code) => {
          if (picking === 'everyday') onChange(code, also.filter((c) => c !== code));
          else if (code !== everyday && !also.includes(code)) onChange(everyday, [...also, code]);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </StartPage>
  );
}

/** Setup 2 of 4: ticked account templates, "Free covers 5", a counter, rename, add another. */
export function AccountsStep({
  items,
  everyday,
  onChange,
  onBack,
  onNext,
}: {
  items: SuggestedAccount[];
  everyday: string;
  onChange: (items: SuggestedAccount[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const s = strings.start;
  const { colors } = useTheme();
  const [renaming, setRenaming] = useState<{ key: string | null; name: string; currency: string } | null>(null);
  const [limitFor, setLimitFor] = useState<string | null>(null);
  const [pickCurrency, setPickCurrency] = useState(false);
  const ticked = items.filter((a) => a.ticked).length;

  const toggle = (a: SuggestedAccount) => {
    if (!a.ticked && ticked >= FREE_LIMITS.accounts) return setLimitFor(a.name);
    onChange(items.map((x) => (x.key === a.key ? { ...x, ticked: !x.ticked } : x)));
  };
  const saveRename = () => {
    if (!renaming || !renaming.name.trim()) return setRenaming(null);
    const name = renaming.name.trim();
    if (renaming.key) {
      onChange(items.map((x) => (x.key === renaming.key ? { ...x, name, currency: renaming.currency, renameHint: false, ...defaultAccountLook(name, x.institution) } : x)));
    } else {
      if (ticked >= FREE_LIMITS.accounts) {
        setRenaming(null);
        return setLimitFor(name);
      }
      const look = defaultAccountLook(name, null);
      onChange([...items, { key: `${name}-${items.length}`, name, currency: renaming.currency, institution: null, ...look, ticked: true, renameHint: false }]);
    }
    setRenaming(null);
  };

  return (
    <StartPage
      onBack={onBack}
      step={2}
      title={s.accountsTitle}
      body={s.accountsBody}
      footer={
        <>
          <Text style={[styles.small, { color: colors.inkMuted, textAlign: 'center' }]}>{s.balancesLater}</Text>
          <Button label={s.continueWith(ticked)} onPress={onNext} />
        </>
      }
    >
      <Note tone="teal" icon="star">
        {s.freeNote}
      </Note>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        {items.map((a, i) => (
          <View key={a.key} style={[styles.row, i < items.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
            <Pressable onPress={() => toggle(a)} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: a.ticked }} accessibilityLabel={a.name}>
              <View style={[styles.box, a.ticked ? { backgroundColor: colors.accent, borderColor: colors.accent } : { borderColor: colors.border }]}>
                {a.ticked ? <Icon name="tick" size={13} color={colors.onAccent} strokeWidth={3} /> : null}
              </View>
            </Pressable>
            <Pressable style={styles.rowMain} onPress={() => setRenaming({ key: a.key, name: a.name, currency: a.currency })}>
              <IconChip icon={a.icon} color={a.color} size={34} />
              <View style={{ flex: 1, opacity: a.ticked ? 1 : 0.55 }}>
                <Text style={[styles.name, { color: colors.ink }]}>{a.name}</Text>
                <Text style={[styles.small, { color: colors.inkMuted }]} numberOfLines={1}>
                  {a.renameHint ? s.renameHint(a.currency, a.currency === 'PKR' ? 'Alfalah' : null) : s.tapToRename(a.currency)}
                </Text>
              </View>
            </Pressable>
          </View>
        ))}
      </View>
      <View style={styles.addRow}>
        <LinkButton label={s.addAnother} onPress={() => setRenaming({ key: null, name: '', currency: everyday })} />
        <Text style={[styles.count, { color: colors.inkMuted }]}>{s.freeCount(ticked, FREE_LIMITS.accounts)}</Text>
      </View>

      <BottomSheet visible={renaming !== null && !pickCurrency} onClose={() => setRenaming(null)} title={renaming?.key ? s.renameTitle : s.newAccountTitle}>
        <View style={{ gap: 12 }}>
          <Field label={strings.start.renameTitle} value={renaming?.name ?? ''} autoFocus onChangeText={(name) => setRenaming((r) => (r ? { ...r, name } : r))} onSubmitEditing={saveRename} />
          <Pressable onPress={() => setPickCurrency(true)} style={[styles.select, { backgroundColor: colors.filled }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.lbl, { color: colors.inkMuted }]}>CURRENCY</Text>
              <Text style={[styles.selectValue, { color: colors.ink, fontSize: 14 }]}>{renaming?.currency}</Text>
            </View>
            <Icon name="down" size={13} color={colors.inkMuted} strokeWidth={2.2} />
          </Pressable>
          <Button label={strings.common.save} onPress={saveRename} disabled={!renaming?.name.trim()} />
        </View>
      </BottomSheet>
      <CurrencySheet
        visible={pickCurrency}
        selected={renaming?.currency}
        onSelect={(currency) => {
          setRenaming((r) => (r ? { ...r, currency } : r));
          setPickCurrency(false);
        }}
        onClose={() => setPickCurrency(false)}
      />

      <BottomSheet visible={limitFor !== null} onClose={() => setLimitFor(null)}>
        <View style={{ gap: 12 }}>
          <View style={[styles.hero, { backgroundColor: colors.warningSoft }]}>
            <Icon name="star" size={28} color={colors.warning} strokeWidth={1.8} />
          </View>
          <Text style={[styles.sheetTitle, { color: colors.ink }]}>{s.limitTitle}</Text>
          <Text style={[styles.body, { color: colors.inkSecondary }]}>
            {s.limitBody(
              <Text key="n" style={{ color: colors.ink, fontFamily: fonts.sansBold }}>
                {limitFor}
              </Text>,
            )}
          </Text>
          <Button label={s.keepFive} onPress={() => setLimitFor(null)} />
          <Text style={[styles.small, { color: colors.inkMuted, textAlign: 'center' }]}>{s.limitNote}</Text>
        </View>
      </BottomSheet>
    </StartPage>
  );
}

const styles = StyleSheet.create({
  select: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.field, paddingHorizontal: 13, paddingVertical: 11, borderWidth: 1.5, borderColor: 'transparent' },
  selectValue: { fontFamily: fonts.sansBold, fontSize: 16 },
  lbl: { fontFamily: fonts.sansBold, fontSize: 10.5, letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  chipText: { fontFamily: fonts.sansBold, fontSize: 13 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
  body: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20 },
  card: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.sansSemiBold, fontSize: 14 },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontFamily: fonts.mono, fontSize: 12 },
  hero: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 19 },
});
