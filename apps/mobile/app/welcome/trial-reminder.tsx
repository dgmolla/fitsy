import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { WelcomeActions } from '@/components/WelcomeActions';
import { TrialArtwork } from '@/components/TrialArtwork';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { usePurchases } from '@/lib/usePurchases';
import { purchaseTerms } from '@/lib/purchaseTerms';
import { useRouteContinuation } from '@/lib/useRouteContinuation';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { readReminderPreferences, saveReminderPreferences } from '@/lib/notificationSchedule';
import { getExpoPushTokenAsync, requestPermissionsAsync } from '@/lib/useNotifications';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { trackOnboardingScreenView, trackReminderAction, trackNotificationPermissionDenied, trackNotificationPermissionGranted,
  trackNotificationPrimingAllowTapped, trackNotificationPrimingShown, trackNotificationPrimingSkipTapped } from '@/lib/analytics';

export default function TrialReminderScreen() {
  const focused = useIsFocused();
  useOnboardingStep('trial-reminder');
  const [busy, setBusy] = useState(false);
  const { ready, offering, introEligibility, introEligibilityReady, entitled } = usePurchases();
  const offers = [offering?.annual, offering?.monthly].map(pkg => purchaseTerms(pkg?.product, pkg ? introEligibility[pkg.product.identifier] : undefined));
  const trial = offers.find(terms => terms?.trial)?.trial;
  const { begin } = useRouteContinuation();
  const pending = useRef(false);
  useEffect(() => { if (focused && entitled === true) router.replace('/welcome/payment'); }, [focused, entitled]);
  useEffect(() => { if (trial) { trackOnboardingScreenView('trial-reminder'); trackNotificationPrimingShown(); } }, [trial]);
  async function registerPushToken() {
    try { const token = await getExpoPushTokenAsync(); if (token) await api.post('/api/user/push-token', { token }); }
    catch { /* Local reminders do not require a push token. */ }
  }
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
        const prefs = await readReminderPreferences(session.user.id);
        await saveReminderPreferences(session.user.id, { ...prefs, trial: true });
        trackReminderAction({ action: 'preferences_changed', meals: prefs.meals, trial: true });
        void registerPushToken();
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
  return <WelcomeScreen progress={1} title="A heads-up before your trial ends."
    subtitle="Allow notifications and we'll remind you before an eligible trial renews."
    canContinue={!busy} showBack={!busy} onContinue={() => { void allow(); }}
    footerContent={<WelcomeActions label={busy ? 'Asking…' : 'Remind me'} onPress={() => { void allow(); }} disabled={busy}
      testID="trial-reminder-allow" secondaryLabel="Not now" onSecondary={skip} secondaryTestID="trial-reminder-skip" />}>
    <TrialArtwork reminder />
    <Text style={s.note}>If you start a free trial, we'll use its confirmed end date to schedule a reminder about two days before renewal.</Text>
    <Text style={s.quiet}>Notifications are optional. You can manage them in settings.</Text>
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  note: { ...TEXT.bodySmall, color: EDITORIAL.textMid, textAlign: 'center', lineHeight: 21 },
  quiet: { ...TEXT.bodySmall, textAlign: 'center', marginTop: 18, color: EDITORIAL.textSoft },
});
