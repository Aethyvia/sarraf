import { eq } from 'drizzle-orm';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Card, Header, LinkButton, Screen, SectionLabel, ToggleRow } from '@/components/ui';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { strings } from '@/i18n/strings';
import { notificationsAllowed, syncNotifications } from '@/services/notifications';
import { goBack } from '@/state/nav';
import { useSettings } from '@/state/settings';
import { fonts, radius, useTheme } from '@/theme';

type Key = 'notifyBudget80' | 'notifyBudget100' | 'notifyRecurringDue' | 'notifyExpectedLate' | 'notifyInTransit' | 'notifyBackupProblems';

/** Settings → Notifications (Ideas added Nov 7): each kind can be switched on or off. */
export default function NotificationSettingsScreen() {
  const s = strings.notifications;
  const current = useSettings();
  const { colors } = useTheme();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  // Opening this screen is the moment to ask the phone for permission.
  useEffect(() => {
    void notificationsAllowed(true).then((ok) => {
      setAllowed(ok);
      if (ok) void syncNotifications();
    });
  }, []);

  const toggle = (key: Key) => (value: boolean) => {
    db.update(settings).set({ [key]: value }).where(eq(settings.id, 1)).run();
  };
  const row = (key: Key, title: string, detail: string) => <ToggleRow title={title} detail={detail} value={current[key]} onChange={toggle(key)} />;

  return (
    <Screen>
      <Header title={s.title} onBack={goBack} />
      {allowed === false ? (
        <View style={[styles.blocked, { backgroundColor: colors.warningSoft }]}>
          <Text style={[styles.blockedText, { color: colors.warning }]}>{s.blocked}</Text>
          <LinkButton label={s.openSettings} onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}
      <SectionLabel>{s.budgets}</SectionLabel>
      <Card style={styles.card}>
        {row('notifyBudget80', s.budget80, s.budget80Detail)}
        {row('notifyBudget100', s.budget100, s.budget100Detail)}
      </Card>
      <SectionLabel>{s.reminders}</SectionLabel>
      <Card style={styles.card}>
        {row('notifyRecurringDue', s.recurring, s.recurringDetail)}
        {row('notifyExpectedLate', s.late, s.lateDetail)}
        {row('notifyInTransit', s.transit, s.transitDetail)}
      </Card>
      <SectionLabel>{s.backup}</SectionLabel>
      <Card style={styles.card}>{row('notifyBackupProblems', s.backupProblems, s.backupDetail)}</Card>
      <Text style={[styles.note, { color: colors.inkMuted }]}>{s.hideNote}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 16, paddingVertical: 4 },
  note: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 2 },
  blocked: { borderRadius: radius.field, padding: 12, gap: 4 },
  blockedText: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18 },
});
