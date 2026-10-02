import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import { supabase } from './supabase';
import { trackReminderAction } from './analytics';
import { usePurchases } from './usePurchases';
import { DEFAULT_REMINDER_PREFERENCES, REMINDER_PREFIX, planReminders, trialReminderDate, type ReminderPreferences } from './notificationPlan';
import { readReminderPreferences, readScheduledReminders, reconcileReminderOwnership, replaceReminders, reminderDestination, saveReminderPreferences, subscribeReminderPreferences } from './notificationSchedule';
import { reconcileDevTrialReminderOwnership } from './devTrialReminderProbe';
import type { PurchasesEntitlementInfo } from 'react-native-purchases';

interface ReminderContextValue { userId: string | null; preferences: ReminderPreferences; scheduled: { kind: string; date: string }[]; save: (value: ReminderPreferences) => Promise<void> }
const ReminderContext = createContext<ReminderContextValue | null>(null);
const reportFailure = (error: unknown) => console.warn('[reminders]', error instanceof Error ? error.message : error);
const missedTrialReminderWindow = (subscription: PurchasesEntitlementInfo | undefined, now: number) => {
  const expiration = Date.parse(subscription?.expirationDate ?? '');
  const start = Date.parse(subscription?.latestPurchaseDate ?? '');
  return !!subscription?.isActive && subscription.periodType === 'TRIAL' && subscription.willRenew &&
    Number.isFinite(expiration) && Number.isFinite(start) && expiration - start > 2 * 24 * 3_600_000 &&
    expiration > now && trialReminderDate(new Date(expiration)).getTime() <= now;
};
const explainMissedTrialReminder = () => Alert.alert('Trial reminder time passed',
  'The 48-hour reminder time for this trial has passed, so Fitsy cannot schedule it now. Check your trial end date and renewal in subscription settings.');

export function ReminderProvider({ children }: { children: React.ReactNode }) {
  const { entitled, customerInfo, ready, refresh } = usePurchases();
  const pathname = usePathname();
  const [account, setAccount] = useState<{ ready: boolean; id: string | null }>({ ready: false, id: null });
  const [loaded, setLoaded] = useState<{ id: string | null; values: ReminderPreferences } | null>(null);
  const [revision, setRevision] = useState(0);
  const [scheduled, setScheduled] = useState<{ id: string | null; values: { kind: string; date: string }[] }>({ id: null, values: [] });
  const [response, setResponse] = useState<Notifications.NotificationResponse | null>(null);
  const userRef = useRef(account.id); userRef.current = account.id;
  const scheduledAccountRef = useRef<string | null | undefined>(undefined);
  const failedTrialNoticeRef = useRef<string | null>(null);
  const pendingTrialOptInRef = useRef<string | null>(null);
  const preferences = loaded?.id === account.id ? loaded.values : DEFAULT_REMINDER_PREFERENCES;

  useEffect(() => {
    let live = true; let authEventReceived = false;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true;
      if (live) setAccount({ ready: true, id: session?.user.id ?? null });
      if (!session) {
        void replaceReminders(null, []).catch(reportFailure);
        void reconcileDevTrialReminderOwnership(null).catch(reportFailure);
      }
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
    if (!account.ready || scheduledAccountRef.current === account.id) return;
    let live = true;
    // Keep the resolved account's jobs if its preference read fails at boot.
    void Promise.all([reconcileReminderOwnership(account.id), reconcileDevTrialReminderOwnership(account.id)])
      .then(() => { if (live) scheduledAccountRef.current = account.id; })
      .catch(reportFailure);
    return () => { live = false; };
  }, [account.ready, account.id, revision]);

  useEffect(() => {
    let live = true;
    void readReminderPreferences(account.id, { throwOnError: true })
      .then(values => { if (live) setLoaded({ id: account.id, values }); })
      .catch(reportFailure);
    return () => { live = false; };
  }, [account.id, revision]);

  useEffect(() => {
    let live = true;
    const userId = account.ready && ready && loaded?.id === account.id ? account.id : undefined;
    const now = new Date();
    const subscription = customerInfo?.entitlements.all.pro;
    if (pendingTrialOptInRef.current && pendingTrialOptInRef.current !== account.id) pendingTrialOptInRef.current = null;
    if (pendingTrialOptInRef.current && customerInfo && entitled === true) {
      pendingTrialOptInRef.current = null;
      if (preferences.trial && missedTrialReminderWindow(subscription, now.getTime())) explainMissedTrialReminder();
    }
    const nativeUnresolved = !!userId && preferences.trial && !customerInfo;
    const plan = planReminders({ now, userId: account.id, entitled: entitled === true, preferences, subscription });
    const trial = userId ? plan.find(item => item.kind === 'trial') : undefined;
    if (!preferences.trial) failedTrialNoticeRef.current = null;
    const expiry = Date.parse(subscription?.expirationDate ?? '');
    const start = Date.parse(subscription?.latestPurchaseDate ?? '');
    const legacyExpiry = userId && !trial && entitled === true && preferences.trial && subscription?.isActive &&
      subscription.periodType === 'TRIAL' && subscription.willRenew && Number.isFinite(expiry) &&
      Number.isFinite(start) && expiry - start > 2 * 24 * 3_600_000 && expiry > now.getTime() &&
      trialReminderDate(new Date(expiry)).getTime() <= now.getTime() ? expiry : undefined;
    const notifyUnconfirmedTrial = () => {
      if (!live || (!trial && !legacyExpiry)) return;
      const key = `${account.id}:${trial?.identifier ?? `${REMINDER_PREFIX}trial.${legacyExpiry}`}`;
      if (failedTrialNoticeRef.current === key) return;
      failedTrialNoticeRef.current = key;
      Alert.alert(legacyExpiry ? 'Trial reminder status unknown' : 'Trial reminder unavailable',
        legacyExpiry ? 'Device notification permission is off or unavailable. We cannot confirm whether your trial reminder was delivered. Check your trial end date and renewal in subscription settings.'
          : 'We could not confirm your trial reminder. Check your trial end date and renewal in subscription settings.');
    };
    // While native identity is unresolved, update meal jobs without removing
    // this account's trial request or an unread delivered trial notice.
    const replacement = nativeUnresolved ? replaceReminders(userId, plan, 'current-account-trial')
      : legacyExpiry !== undefined ? replaceReminders(userId, plan, legacyExpiry)
        : replaceReminders(userId, plan, userId && preferences.trial ? 'presented-current-account-trial' : undefined);
    void replacement.then(() => readScheduledReminders(account.id))
      .then(async values => {
        if (live) {
          setScheduled({ id: account.id, values });
          const pendingTrial = trial ? values.some(value => value.kind === 'trial' && value.date === trial.date.toISOString())
            : !!legacyExpiry && values.some(value => value.kind === 'trial');
          if (pendingTrial) failedTrialNoticeRef.current = null;
          else if (trial) notifyUnconfirmedTrial();
          else if (legacyExpiry) {
            // A fired request disappears from the pending list. That alone
            // cannot establish delivery or failure, so only warn on permission loss.
            const permission = await Notifications.getPermissionsAsync().catch(error => { reportFailure(error); return null; });
            if (live && permission?.status !== 'granted') notifyUnconfirmedTrial();
          }
        }
      }).catch(error => {
        reportFailure(error);
        notifyUnconfirmedTrial();
      });
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
    const newTrialOptIn = !preferences.trial && values.trial;
    await saveReminderPreferences(id, values);
    trackReminderAction({ action: 'preferences_changed', ...values });
    if (userRef.current === id) {
      setLoaded({ id, values });
      if (!values.trial) pendingTrialOptInRef.current = null;
      else if (newTrialOptIn && (!customerInfo || entitled !== true)) pendingTrialOptInRef.current = id;
      else if (newTrialOptIn && missedTrialReminderWindow(customerInfo?.entitlements.all.pro, Date.now())) explainMissedTrialReminder();
    }
  }
  return <ReminderContext.Provider value={{ userId: account.id, preferences, scheduled: scheduled.id === account.id ? scheduled.values : [], save }}>{children}</ReminderContext.Provider>;
}
export function useReminders() {
  const value = useContext(ReminderContext);
  if (!value) throw new Error('ReminderProvider is required');
  return value;
}
