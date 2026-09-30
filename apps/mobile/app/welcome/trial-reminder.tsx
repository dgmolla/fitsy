import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { WelcomeActions } from '@/components/WelcomeActions';
import { TrialArtwork } from '@/components/TrialArtwork';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { usePurchases } from '@/lib/usePurchases';
import { purchaseTerms } from '@/lib/purchaseTerms';
import { defaultTrialPlan, trialPresentation } from '@/lib/trialPresentation';
import { devTrialVisualOffer } from '@/lib/devTrialVisualOffer';
import { useRouteContinuation } from '@/lib/useRouteContinuation';
import { supabase } from '@/lib/supabase';
import { readReminderPreferences, saveReminderPreferences } from '@/lib/notificationSchedule';
import { getNotificationPermission, requestPermissionsAsync, type NotificationPermissionStatus } from '@/lib/useNotifications';
import { registerExpoPushToken } from '@/lib/pushTokenRegistration';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { trackOnboardingScreenView, trackReminderAction, trackNotificationPermissionDenied, trackNotificationPermissionGranted,
  trackNotificationPrimingAllowTapped, trackNotificationPrimingShown, trackNotificationPrimingSkipTapped } from '@/lib/analytics';

export default function TrialReminderScreen() {
  const { devTrialVisual } = useLocalSearchParams<{ devTrialVisual?: string }>();
  const visualRequested = __DEV__ && devTrialVisual === '1';
  const focused = useIsFocused();
  useOnboardingStep('trial-reminder');
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermissionStatus | null>(null);
  const { ready, offering, introEligibility, introEligibilityReady, entitled } = usePurchases();
  const visual = devTrialVisualOffer(offering, visualRequested);
  const shownOffering = visual?.offering ?? offering;
  const shownEligibility = visual?.eligibility ?? introEligibility;
  const eligibilityReady = !!visual || introEligibilityReady;
  const annual = purchaseTerms(shownOffering?.annual?.product, shownOffering?.annual ? shownEligibility[shownOffering.annual.product.identifier] : undefined);
  const monthly = purchaseTerms(shownOffering?.monthly?.product, shownOffering?.monthly ? shownEligibility[shownOffering.monthly.product.identifier] : undefined);
  const selectedPlan = defaultTrialPlan(annual, monthly);
  const presentation = trialPresentation(selectedPlan === 'yearly' ? annual : monthly);
  const trial = presentation.trial;
  const { begin } = useRouteContinuation();
  const pending = useRef(false);
  const navigating = useRef(false);
  useEffect(() => { if (focused) navigating.current = false; }, [focused]);
  useEffect(() => { if (focused && entitled === true) router.replace('/welcome/payment'); }, [focused, entitled]);
  useEffect(() => { if (trial && !visualRequested) { trackOnboardingScreenView('trial-reminder'); trackNotificationPrimingShown(); } }, [trial, visualRequested]);
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
    if (!trial || pending.current || navigating.current) return;
    if (visualRequested) {
      navigating.current = true;
      router.push('/welcome/payment?devTrialVisual=1');
      return;
    }
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
      if (isCurrent()) {
        navigating.current = true;
        router.push(returnToSignIn ? '/welcome/signin?returnTo=trial-reminder' : '/welcome/payment');
      }
    }
  }
  function skip() {
    if (pending.current || navigating.current) return;
    navigating.current = true;
    if (!visualRequested) trackNotificationPrimingSkipTapped();
    router.push(visualRequested ? '/welcome/payment?devTrialVisual=1' : '/welcome/payment');
  }
  if (!ready) return null;
  if (!shownOffering) return <Redirect href="/welcome/trial" />;
  if (!eligibilityReady) return null;
  if (!trial) return <Redirect href="/welcome/payment" />;
  if (permission === null) return null;
  // Calendar-month trials have no fixed day count, but their confirmed end
  // date still allows the existing one-off scheduler to choose a safe time.
  const inBrowser = Platform.OS === 'web';
  const canSchedule = !inBrowser && presentation.reminderAvailable;
  const canOptIn = canSchedule && permission !== 'denied';
  const title = inBrowser ? 'Reminders need the mobile app' : !canSchedule ? 'Review your trial' : permission === 'denied' ? 'Reminders are off' : 'Get a trial reminder';
  const subtitle = inBrowser ? 'You can still review your plan and renewal terms.'
    : !canSchedule ? 'This offer is too short for a reminder before the cancellation deadline.'
    : permission === 'denied' ? 'Turn on notifications in device settings if you want a reminder.'
      : `With notifications allowed, we can remind you ${presentation.reminderDay ? `around day ${presentation.reminderDay}` : 'before the end'} of your ${trial} ${selectedPlan === 'yearly' ? 'annual' : 'monthly'} trial.`;
  return <WelcomeScreen progress={1} title={title} subtitle={subtitle}
    canContinue={!busy} showBack={!busy} onContinue={() => { if (canOptIn) void allow(); else skip(); }}
    footerContent={<WelcomeActions label={busy ? 'Asking…' : canOptIn ? 'Remind me' : 'Continue to plans'} onPress={canOptIn ? () => { void allow(); } : skip} disabled={busy}
      testID="trial-reminder-allow" secondaryLabel={canOptIn ? 'Not now' : undefined} onSecondary={canOptIn ? skip : undefined} secondaryTestID="trial-reminder-skip" />}>
    <TrialArtwork reminder />
    <Text style={s.note} testID="trial-reminder-note">{visual ? 'Synthetic trial eligibility for visual testing. Device permission is real; this preview schedules nothing.' : canOptIn ? 'We schedule it after purchase, once the store confirms your trial end date. Check settings for its exact time.' : 'Review the exact trial and renewal terms on the next screen.'}</Text>
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  note: { ...TEXT.bodySmall, color: EDITORIAL.textMid, textAlign: 'center', lineHeight: 21 },
});
