import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import { supabase } from './supabase';
import { trackReminderAction } from './analytics';
import { usePurchases } from './usePurchases';
import { DEFAULT_REMINDER_PREFERENCES, REMINDER_PREFIX, planReminders, type ReminderPreferences } from './notificationPlan';
import { readReminderPreferences, readScheduledReminders, replaceReminders, reminderDestination, saveReminderPreferences, subscribeReminderPreferences } from './notificationSchedule';

interface ReminderContextValue { userId: string | null; preferences: ReminderPreferences; scheduled: { kind: string; date: string }[]; save: (value: ReminderPreferences) => Promise<void> }
const ReminderContext = createContext<ReminderContextValue | null>(null);
const reportFailure = (error: unknown) => console.warn('[reminders]', error instanceof Error ? error.message : error);

export function ReminderProvider({ children }: { children: React.ReactNode }) {
  const { entitled, customerInfo, ready, refresh } = usePurchases();
  const pathname = usePathname();
  const [account, setAccount] = useState<{ ready: boolean; id: string | null }>({ ready: false, id: null });
  const [loaded, setLoaded] = useState<{ id: string | null; values: ReminderPreferences } | null>(null);
  const [revision, setRevision] = useState(0);
  const [scheduled, setScheduled] = useState<{ id: string | null; values: { kind: string; date: string }[] }>({ id: null, values: [] });
  const [response, setResponse] = useState<Notifications.NotificationResponse | null>(null);
  const userRef = useRef(account.id); userRef.current = account.id;
  const preferences = loaded?.id === account.id ? loaded.values : DEFAULT_REMINDER_PREFERENCES;

  useEffect(() => {
    let live = true; let authEventReceived = false;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true;
      if (live) setAccount({ ready: true, id: session?.user.id ?? null });
      if (!session) void replaceReminders(null, []).catch(reportFailure);
    });
    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (live && !authEventReceived) setAccount({ ready: true, id: sessionData.session?.user.id ?? null });
    }).catch(error => { if (live) setAccount({ ready: true, id: null }); reportFailure(error); });
    const unsubscribe = subscribeReminderPreferences(() => setRevision(value => value + 1));
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh().catch(reportFailure).finally(() => { if (live) setRevision(value => value + 1); });
    });
    return () => { live = false; data.subscription.unsubscribe(); unsubscribe(); foreground.remove(); };
  }, [refresh]);

  useEffect(() => {
    let live = true;
    void readReminderPreferences(account.id).then(values => { if (live) setLoaded({ id: account.id, values }); });
    return () => { live = false; };
  }, [account.id, revision]);

  useEffect(() => {
    let live = true;
    const userId = account.ready && ready && loaded?.id === account.id ? account.id : undefined;
    const plan = planReminders({ now: new Date(), userId: account.id, entitled: entitled === true, preferences, subscription: customerInfo?.entitlements.all.pro });
    void replaceReminders(userId, plan).then(() => readScheduledReminders(account.id))
      .then(values => { if (live) setScheduled({ id: account.id, values }); }).catch(reportFailure);
    return () => { live = false; };
  }, [account, ready, loaded, entitled, preferences, customerInfo, revision]);

  useEffect(() => {
    let live = true; let received = false;
    Notifications.setNotificationHandler({ handleNotification: async notification => {
      const show = !notification.request.identifier.startsWith(REMINDER_PREFIX) || notification.request.content.data?.kind !== 'meal';
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    } });
    const listener = Notifications.addNotificationResponseReceivedListener(value => { received = true; setResponse(value); });
    void Notifications.getLastNotificationResponseAsync().then(value => { if (live && !received) setResponse(value); }).catch(reportFailure);
    return () => { live = false; listener.remove(); };
  }, []);

  useEffect(() => {
    if (!response || !account.ready || !ready || pathname === '/') return;
    const destination = reminderDestination(response.notification.request.content.data ?? {}, account.id);
    setResponse(null);
    void Notifications.clearLastNotificationResponseAsync().catch(reportFailure);
    if (destination) {
      trackReminderAction({ action: 'opened', kind: destination === '/notification-settings' ? 'trial' : 'meal' });
      router.push(destination);
    }
  }, [response, account, ready, pathname]);

  async function save(values: ReminderPreferences) {
    if (!account.id) throw new Error('Sign in to change reminders.');
    const id = account.id;
    await saveReminderPreferences(id, values);
    trackReminderAction({ action: 'preferences_changed', ...values });
    if (userRef.current === id) setLoaded({ id, values });
  }
  return <ReminderContext.Provider value={{ userId: account.id, preferences, scheduled: scheduled.id === account.id ? scheduled.values : [], save }}>{children}</ReminderContext.Provider>;
}
export function useReminders() {
  const value = useContext(ReminderContext);
  if (!value) throw new Error('ReminderProvider is required');
  return value;
}
