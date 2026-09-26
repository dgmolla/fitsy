import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { WelcomeActions } from '@/components/WelcomeActions';
import { TrialArtwork } from '@/components/TrialArtwork';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { usePurchases } from '@/lib/usePurchases';
import { purchaseTerms } from '@/lib/purchaseTerms';
import { canOfferTrialReminder } from '@/lib/notificationPlan';
import { useRouteContinuation } from '@/lib/useRouteContinuation';
import { supabase } from '@/lib/supabase';
import { readReminderPreferences, saveReminderPreferences } from '@/lib/notificationSchedule';
import { getNotificationPermission, requestPermissionsAsync, type NotificationPermissionStatus } from '@/lib/useNotifications';
import { registerExpoPushToken } from '@/lib/pushTokenRegistration';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { trackOnboardingScreenView, trackReminderAction, trackNotificationPermissionDenied, trackNotificationPermissionGranted,
  trackNotificationPrimingAllowTapped, trackNotificationPrimingShown, trackNotificationPrimingSkipTapped } from '@/lib/analytics';

export default function TrialReminderScreen() {
  const focused = useIsFocused();
  useOnboardingStep('trial-reminder');
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermissionStatus | null>(null);
  const { ready, offering, introEligibility, introEligibilityReady, entitled } = usePurchases();
  const offers = [offering?.annual, offering?.monthly].map(pkg => purchaseTerms(pkg?.product, pkg ? introEligibility[pkg.product.identifier] : undefined));
  const trialOffer = offers.find(terms => terms?.trial);
  const trial = trialOffer?.trial;
  const { begin } = useRouteContinuation();
  const pending = useRef(false);
  useEffect(() => { if (focused && entitled === true) router.replace('/welcome/payment'); }, [focused, entitled]);
  useEffect(() => { if (trial) { trackOnboardingScreenView('trial-reminder'); trackNotificationPrimingShown(); } }, [trial]);
  useEffect(() => {
    if (!focused) return;
    let current = true;
    let request = 0;
    const refresh = () => {
      const latest = ++request;
      void getNotificationPermission().then(status => { if (current && latest === request) setPermission(status); });
    };
    refresh();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { current = false; listener.remove(); };
  }, [focused]);
  async function allow() {
    if (!trial || pending.current) return;
    pending.current = true;
    const isCurrent = begin();
    setBusy(true);
    trackNotificationPrimingAllowTapped();
    let returnToSignIn = false;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isCurrent()) return;
      if (!session) {
        returnToSignIn = true;
        return;
      }
      const { status } = await requestPermissionsAsync();
      if (!isCurrent()) return;
      if (status === 'granted') {
        trackNotificationPermissionGranted();
        const prefs = await readReminderPreferences(session.user.id, { throwOnError: true });
        const latestSession = await supabase.auth.getSession();
        if (!isCurrent() || latestSession.data.session?.user.id !== session.user.id) return;
        await saveReminderPreferences(session.user.id, { ...prefs, trial: true });
        trackReminderAction({ action: 'preferences_changed', meals: prefs.meals, trial: true });
        void registerExpoPushToken(session.user.id);
      } else trackNotificationPermissionDenied();
    } catch { /* Permission or storage failure must not block plan review. */ }
    finally {
      pending.current = false;
      setBusy(false);
      if (isCurrent()) router.push(returnToSignIn ? '/welcome/signin?returnTo=trial-reminder' : '/welcome/payment');
    }
  }
  function skip() {
    if (pending.current) return;
    trackNotificationPrimingSkipTapped();
    router.push('/welcome/payment');
  }
  if (!ready) return null;
  if (!offering) return <Redirect href="/welcome/trial" />;
  if (!introEligibilityReady) return null;
  if (!trial) return <Redirect href="/welcome/payment" />;
  if (permission === null) return null;
  // Calendar-month trials have no fixed day count, but their confirmed end
  // date still allows the existing one-off scheduler to choose a safe time.
  const inBrowser = Platform.OS === 'web';
  const canSchedule = !inBrowser && offers.some(canOfferTrialReminder);
  const canOptIn = canSchedule && permission !== 'denied';
  const title = inBrowser ? 'Trial reminders need the Fitsy mobile app.' : !canSchedule ? 'Review your trial before it ends.' : permission === 'denied' ? 'Notifications are off.' : 'We can notify you before your trial ends.';
  const subtitle = inBrowser ? 'This browser cannot schedule trial notifications. Review the exact trial and renewal terms on the next screen.'
    : !canSchedule ? 'This trial may be too short for a reminder before the cancellation deadline.'
    : permission === 'denied' ? 'You can turn on notifications in device settings if you want a trial reminder.'
      : 'Choose a plan with enough trial time, then allow notifications for a reminder.';
  return <WelcomeScreen progress={1} title={title} subtitle={subtitle}
    canContinue={!busy} showBack={!busy} onContinue={() => { if (canOptIn) void allow(); else skip(); }}
    footerContent={<WelcomeActions label={busy ? 'Asking…' : canOptIn ? 'Remind me' : 'Continue to plans'} onPress={canOptIn ? () => { void allow(); } : skip} disabled={busy}
      testID="trial-reminder-allow" secondaryLabel={canOptIn ? 'Not now' : undefined} onSecondary={canOptIn ? skip : undefined} secondaryTestID="trial-reminder-skip" />}>
    <TrialArtwork reminder />
    <Text style={s.note}>{canOptIn ? 'If permission is granted and your confirmed trial end date allows it, Fitsy schedules a local reminder about two days before renewal.' : 'You can review the exact trial and renewal terms on the next screen.'}</Text>
    <Text style={s.quiet}>Notifications are optional. You can manage them in settings.</Text>
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  note: { ...TEXT.bodySmall, color: EDITORIAL.textMid, textAlign: 'center', lineHeight: 21 },
  quiet: { ...TEXT.bodySmall, textAlign: 'center', marginTop: 18, color: EDITORIAL.textSoft },
});
