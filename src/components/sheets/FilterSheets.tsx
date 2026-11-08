import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet, Button, LinkButton, SelectorRow, SheetOption } from '@/components/ui';
import { strings } from '@/i18n/strings';
import { monthOf, monthRange, today as todayDate } from '@/lib/dates';
import { formatShortDate } from '@/lib/format-date';
import { fonts, useTheme } from '@/theme';
import type { PickerItem } from './PickerSheet';

/** Pick several values for one Transactions filter; Apply or Clear. */
export function MultiPickerSheet({
  visible,
  title,
  items,
  selected,
  onApply,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: (PickerItem & { section?: string })[];
  selected: string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected);
  const [shownFor, setShownFor] = useState(false);
  if (visible !== shownFor) {
    setShownFor(visible);
    if (visible) setDraft(selected);
  }
  const toggle = (id: string) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <ScrollView style={{ maxHeight: 420 }}>
        {items.map((item, i) => {
          // A section label above the first item of each section.
          const header = item.section && item.section !== items[i - 1]?.section ? item.section : null;
          return (
            <View key={item.id}>
              {header ? <SectionHeader text={header} /> : null}
              <View style={item.indent ? { paddingStart: 28 } : undefined}>
                <SheetOption title={item.title} detail={item.detail} leading={item.leading} selected={draft.includes(item.id)} onPress={() => toggle(item.id)} />
              </View>
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.buttons}>
        <Button
          kind="secondary"
          label={strings.list.clear}
          style={{ flex: 1 }}
          onPress={() => {
            onApply([]);
            onClose();
          }}
        />
        <Button
          label={strings.list.apply}
          style={{ flex: 1.4 }}
          onPress={() => {
            onApply(draft);
            onClose();
          }}
        />
      </View>
    </BottomSheet>
  );
}

function SectionHeader({ text }: { text: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.section, { color: colors.inkMuted }]}>{text}</Text>;
}

export interface DateRange {
  from: string | null;
  to: string | null;
}

/** Date range (bottom sheet): presets or a custom from–to. */
export function DateRangeSheet({
  visible,
  value,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: DateRange;
  onApply: (range: DateRange) => void;
  onClose: () => void;
}) {
  const s = strings.dateRange;
  const today = todayDate();
  const month = monthRange(monthOf(today));
  const [y, m] = today.split('-').map(Number);
  const threeMonthsAgo = `${m > 2 ? y : y - 1}-${String(((m + 9) % 12) + 1).padStart(2, '0')}-01`;
  const presets: { key: string; label: string; range: DateRange }[] = [
    { key: 'month', label: s.thisMonth, range: { from: month.from, to: month.to } },
    { key: '3m', label: s.last3, range: { from: threeMonthsAgo, to: today } },
    { key: 'year', label: s.thisYear, range: { from: `${y}-01-01`, to: today } },
    { key: 'all', label: s.allTime, range: { from: null, to: null } },
  ];
  const [custom, setCustom] = useState<DateRange>(value);
  const pick = (which: 'from' | 'to') => {
    const base = custom[which] ?? today;
    const [yy, mm, dd] = base.split('-').map(Number);
    DateTimePickerAndroid.open({
      value: new Date(yy, mm - 1, dd),
      mode: 'date',
      onChange: (e, d) => e.type === 'set' && d && setCustom((c) => ({ ...c, [which]: todayDate(d) })),
    });
  };
  const choose = (range: DateRange) => {
    onApply(range);
    onClose();
  };
  const isSelected = (r: DateRange) => r.from === value.from && r.to === value.to;
  return (
    <BottomSheet visible={visible} onClose={onClose} title={s.title}>
      {presets.map((p) => (
        <SheetOption key={p.key} title={p.label} selected={isSelected(p.range)} onPress={() => choose(p.range)} />
      ))}
      <SectionHeader text={s.custom.toUpperCase()} />
      <View style={styles.customRow}>
        <View style={{ flex: 1 }}>
          <SelectorRow label={s.from} value={custom.from ? formatShortDate(custom.from) : '—'} onPress={() => pick('from')} />
        </View>
        <View style={{ flex: 1 }}>
          <SelectorRow label={s.to} value={custom.to ? formatShortDate(custom.to) : '—'} onPress={() => pick('to')} />
        </View>
      </View>
      <Button label={strings.list.apply} onPress={() => choose(custom)} style={{ marginTop: 12 }} />
      <LinkButton label={strings.list.clear} onPress={() => choose({ from: null, to: null })} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  section: { fontFamily: fonts.sansExtraBold, fontSize: 11, letterSpacing: 0.7, paddingTop: 14, paddingBottom: 4, paddingHorizontal: 4 },
  customRow: { flexDirection: 'row', gap: 10 },
});
