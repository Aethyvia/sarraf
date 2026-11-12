import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IconChip, Button, Header, Hint, Screen, SectionLabel, SheetOption } from '@/components/ui';
import { FREE_LIMITS, type LimitedKind } from '@/data/limits';
import { activeItems, applyPlanChoice, overLimit, suggestedKeep, type Keep } from '@/data/plan-ended';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { useAction } from '@/state/actions';
import { useLive } from '@/state/live';
import { goBack } from '@/state/nav';
import { dismissPlanChoice } from '@/state/plan-ended';
import { usePlan } from '@/state/plan';
import { useToast } from '@/state/toast';
import { fonts, useTheme } from '@/theme';

/**
 * Sarraf Plus has ended (Owner, Nov 12): renew, or choose which accounts,
 * ledgers and goals stay active on the free plan. The rest are archived
 * (archive rules apply; nothing is deleted). Closing it archives nothing and
 * it's asked again on the next app open.
 */
export default function PlanEndedScreen() {
  const s = strings.planEnded;
  const { colors } = useTheme();
  const plan = usePlan();
  const toast = useToast();
  const action = useAction();
  const items = useLive((d) => activeItems(d), []);
  const over = useLive((d) => overLimit(d, plan), [plan]);
  const [keep, setKeep] = useState<Keep>(() => suggestedKeep(db));

  const kinds = (['accounts', 'ledgers', 'goals'] as const).filter((k) => items[k].length > FREE_LIMITS[k]);
  const close = () => {
    dismissPlanChoice();
    goBack();
  };
  const toggle = (k: LimitedKind, id: string, locked: boolean) => {
    if (locked) return;
    setKeep((c) => {
      const on = c[k].includes(id);
      if (!on && c[k].length >= FREE_LIMITS[k]) return c;
      return { ...c, [k]: on ? c[k].filter((x) => x !== id) : [...c[k], id] };
    });
  };
  const toArchive = kinds.reduce((n, k) => n + items[k].filter((x) => !keep[k].includes(x.id)).length, 0);
  const confirm = () => {
    if (action.run(() => applyPlanChoice(db, keep))) {
      toast({ message: s.done(toArchive) });
      router.back();
    }
  };

  if (plan === 'plus' || over.accounts + over.ledgers + over.goals === 0) {
    return (
      <Screen>
        <Header title={s.title} onBack={goBack} backIcon="close" />
        <Hint>{s.nothingToDo}</Hint>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={s.title} onBack={close} backIcon="close" />
      {action.ui}
      <Text style={[styles.body, { color: colors.inkSecondary }]}>{s.body}</Text>
      <Button label={s.renew} onPress={() => router.push('/plans')} />
      <Text style={[styles.or, { color: colors.inkMuted }]}>{s.or}</Text>

      {kinds.map((k) => (
        <View key={k} style={{ gap: 4 }}>
          <SectionLabel>{s.keep(s.kinds[k], keep[k].length, FREE_LIMITS[k])}</SectionLabel>
          {items[k].map((x) => {
            const locked = k === 'ledgers' && 'isDefault' in x && !!x.isDefault;
            const on = keep[k].includes(x.id);
            return (
              <SheetOption
                key={x.id}
                title={x.name}
                detail={locked ? s.defaultLedger : on ? s.staysActive : s.archived}
                selected={on}
                disabled={!on && keep[k].length >= FREE_LIMITS[k]}
                leading={'icon' in x && 'color' in x ? <IconChip icon={x.icon as string} color={x.color as string} size={30} /> : undefined}
                onPress={() => toggle(k, x.id, locked)}
              />
            );
          })}
        </View>
      ))}

      <Hint>{s.archiveRules}</Hint>
      <Button kind="secondary" label={s.confirm(toArchive)} onPress={confirm} disabled={toArchive === 0} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  or: { fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.5, textAlign: 'center' },
});
