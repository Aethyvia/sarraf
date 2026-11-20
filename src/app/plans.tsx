import { eq } from 'drizzle-orm';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { BottomSheet, Button, Card, Field, Header, LinkButton, Screen } from '@/components/ui';
import { deviceState } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { store } from '@/services/store';
import { useLive } from '@/state/live';
import { goBack } from '@/state/nav';
import { usePlan } from '@/state/plan';
import { useToast } from '@/state/toast';
import { isLifetime } from '@/data/plan';
import { fonts, useTheme } from '@/theme';

/** Plans (board): Free vs Sarraf Plus. Prices are placeholders until set in the store (owner, open). */
export default function PlansScreen() {
  const s = strings.plans;
  const { colors } = useTheme();
  const toast = useToast();
  const plan = usePlan();
  const renews = useLive((db) => db.select({ r: deviceState.planRenewsAt }).from(deviceState).where(eq(deviceState.id, 1)).get()?.r ?? null, []);
  const [busy, setBusy] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const redeem = async () => {
    setBusy(true);
    setCodeError(null);
    try {
      const r = await store.redeem(code);
      if (r === 'ok') {
        setCodeOpen(false);
        setCode('');
        toast({ message: s.codeOk });
      } else setCodeError(r === 'used' ? s.codeUsed : r === 'expired' ? s.codeExpired : r === 'signIn' ? s.codeSignIn : s.codeUnknown);
    } catch (e) {
      setCodeError((e as Error).message || strings.start.failed);
    } finally {
      setBusy(false);
    }
  };

  const buy = async (kind: 'monthly' | 'yearly') => {
    if (!store.ready) return toast({ message: s.notReady });
    setBusy(true);
    try {
      if (await store.purchase(kind)) toast({ message: s.bought });
      else toast({ message: s.notReady });
    } catch (e) {
      toast({ message: (e as Error).message || strings.start.failed });
    } finally {
      setBusy(false);
    }
  };

  const list = (items: readonly string[]) => (
    <View style={{ gap: 7 }}>
      {items.map((t) => (
        <View key={t} style={styles.item}>
          <Icon name="tick" size={15} color={colors.income} strokeWidth={2.6} />
          <Text style={[styles.itemText, { color: colors.ink }]}>{t}</Text>
        </View>
      ))}
    </View>
  );

  // Lifetime Plus (supporters): just the plan they have, no prices, buttons or codes (owner, Nov 20).
  if (plan === 'plus' && isLifetime(renews)) {
    return (
      <Screen>
        <Header title={s.title} onBack={goBack} />
        <Card style={[styles.lifetime, { borderWidth: 2, borderColor: colors.accent }]}>
          <View style={[styles.tick, { backgroundColor: colors.accent }]}>
            <Icon name="tick" size={30} color={colors.onAccent} strokeWidth={2.8} />
          </View>
          <Text style={[styles.lifetimeName, { color: colors.ink }]}>{s.plus}</Text>
          <Text style={[styles.lifetimeLine, { color: colors.ink }]}>{s.lifetimeActive}</Text>
          <Text style={[styles.lifetimeBody, { color: colors.inkSecondary }]}>{s.lifetimeBody}</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={s.title} onBack={goBack} />
      <Card style={[styles.card, plan === 'free' && { borderWidth: 2, borderColor: colors.border }]}>
        <View style={styles.top}>
          <Text style={[styles.name, { color: colors.ink }]}>{s.free}</Text>
          <Text style={[styles.price, { color: colors.ink }]}>{s.freePrice}</Text>
        </View>
        {plan === 'free' ? <Text style={[styles.small, { color: colors.inkMuted }]}>{s.freeNow}</Text> : null}
        {list(s.freeItems)}
      </Card>
      <Card style={[styles.card, { borderWidth: 2, borderColor: colors.accent }]}>
        <View style={styles.top}>
          <Text style={[styles.name, { color: colors.ink }]}>{s.plus}</Text>
          <Text style={[styles.price, { color: colors.ink }]}>{s.plusPrice}</Text>
        </View>
        <Text style={[styles.small, { color: colors.inkMuted }]}>
          {plan === 'plus'
            ? [s.plusNow, isLifetime(renews) ? s.lifetime : renews ? s.renews(formatShortDate(renews.slice(0, 10))) : null].filter(Boolean).join(' · ')
            : s.plusYearly}
        </Text>
        {list(s.plusItems)}
      </Card>
      {plan === 'free' ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label={s.yearly} style={{ flex: 1 }} disabled={busy} onPress={() => void buy('yearly')} />
          <Button label={s.monthly} kind="secondary" style={{ flex: 1 }} disabled={busy} onPress={() => void buy('monthly')} />
        </View>
      ) : null}
      <LinkButton
        label={s.restore}
        onPress={async () => {
          if (!store.ready) return toast({ message: s.notReady });
          toast({ message: (await store.restore()) ? s.restored : s.nothingToRestore });
        }}
      />
      {plan === 'free' ? <LinkButton label={s.haveCode} onPress={() => (setCode(''), setCodeError(null), setCodeOpen(true))} /> : null}
      <Text style={[styles.small, { color: colors.inkMuted, textAlign: 'center' }]}>{s.note}</Text>

      <BottomSheet visible={codeOpen} onClose={() => setCodeOpen(false)} title={s.codeTitle}>
        <View style={{ gap: 12 }}>
          <Text style={[styles.codeBody, { color: colors.inkSecondary }]}>{s.codeBody}</Text>
          <Field label={s.codeLabel} value={code} onChangeText={(v) => (setCode(v), setCodeError(null))} autoCapitalize="characters" autoCorrect={false} placeholder="SARRAF-XXXX-XXXX" />
          {codeError ? <Text style={[styles.small, { color: colors.expense }]}>{codeError}</Text> : null}
          <Button label={busy ? strings.backup.working : s.codeUse} disabled={busy || !code.trim()} onPress={() => void redeem()} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 8 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  name: { fontFamily: fonts.serif, fontSize: 19 },
  price: { fontFamily: fonts.monoSemiBold, fontSize: 15 },
  small: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
  item: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  itemText: { flex: 1, fontFamily: fonts.sans, fontSize: 13, lineHeight: 18 },
  codeBody: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  lifetime: { padding: 24, gap: 8, alignItems: 'center' },
  tick: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  lifetimeName: { fontFamily: fonts.serif, fontSize: 24 },
  lifetimeLine: { fontFamily: fonts.sansSemiBold, fontSize: 15 },
  lifetimeBody: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
