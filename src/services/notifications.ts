import { addDatabaseChangeListener } from 'expo-sqlite';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { budgetAlertsDue, markBudgetAlerted, planNotifications } from '@/data/reminders';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { today } from '@/lib/dates';

const CHANNEL = 'reminders';
/** Re-plan a moment after data stops changing, not on every write. */
const DEBOUNCE_MS = 3000;

let started = false;

/** Shows notifications while the app is open too, and opens the right screen on tap. */
export function startNotifications(): () => void {
  if (started) return () => {};
  started = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  Notifications.setNotificationChannelAsync(CHANNEL, { name: strings.notifications.channel, importance: Notifications.AndroidImportance.DEFAULT }).catch(() => {});

  const tap = Notifications.addNotificationResponseReceivedListener((response) => {
    const route = response.notification.request.content.data?.route;
    if (typeof route === 'string') router.push(route as never);
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncNotifications(), DEBOUNCE_MS);
  };
  const changes = addDatabaseChangeListener(schedule);
  void syncNotifications();

  return () => {
    tap.remove();
    changes.remove();
    if (timer) clearTimeout(timer);
    started = false;
  };
}

/** True when notifications are allowed; asks once when `ask` is set and the phone still allows asking. */
export async function notificationsAllowed(ask = false): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!ask || !current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Replaces every scheduled Sarraf notification with the current plan. */
export async function syncNotifications(): Promise<void> {
  try {
    if (!(await notificationsAllowed())) return;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const plan = planNotifications(db, { date: today(), time: `${pad(now.getHours())}:${pad(now.getMinutes())}` });
    await Notifications.cancelAllScheduledNotificationsAsync();
    for (const n of plan) {
      const [d, t] = n.at.split('T');
      const [y, m, day] = d.split('-').map(Number);
      const [h, mi] = t.split(':').map(Number);
      const when = new Date(y, m - 1, day, h, mi);
      // A pinned dev "today" can plan dates that are already past on the real clock.
      if (when.getTime() <= now.getTime()) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: n.key,
        content: { title: n.title, body: n.body, data: { route: n.route } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: CHANNEL },
      });
    }
    // Budget alerts go out as soon as a budget crosses 80% or 100%, once per period.
    for (const a of budgetAlertsDue(db, today())) {
      await Notifications.scheduleNotificationAsync({
        identifier: `budget:${a.budgetId}:${a.mark}`,
        content: { title: a.title, body: a.body, data: { route: a.route } },
        trigger: { channelId: CHANNEL },
      });
      markBudgetAlerted(db, a.budgetId, a.mark);
    }
  } catch (e) {
    // Scheduling is best effort; the app works the same without it.
    console.warn('Could not schedule notifications', e);
  }
}
