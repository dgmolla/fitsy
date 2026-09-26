import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { TrialArtwork } from '@/components/TrialArtwork';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { usePurchases } from '@/lib/usePurchases';
import { purchaseTerms } from '@/lib/purchaseTerms';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { withinMs } from '@/lib/async';
import { useRouteContinuation } from '@/lib/useRouteContinuation';

const OFFERING_RETRY_CAP_MS = 5000;

export default function TrialScreen() {
  const focused = useIsFocused();
  useOnboardingStep('trial');
  const { ready, offering, introEligibility, introEligibilityReady, refreshOffering, entitled } = usePurchases();
  const offers = [offering?.annual, offering?.monthly].map(pkg => purchaseTerms(pkg?.product, pkg ? introEligibility[pkg.product.identifier] : undefined));
  const trial = offers.find(terms => terms?.trial)?.trial;
  const [plansChecked, setPlansChecked] = useState(false);
  const retryInFlight = useRef(false);
  const { begin } = useRouteContinuation();
  const checkingPlans = !ready || (offering ? !introEligibilityReady : !plansChecked);
  useEffect(() => { if (focused && entitled === true) router.replace('/welcome/payment'); }, [focused, entitled]);
  useEffect(() => { trackOnboardingScreenView('trial'); }, []);
  useFocusEffect(useCallback(() => {
    if (offering) return;
    let current = true;
    setPlansChecked(false);
    void withinMs(refreshOffering(), OFFERING_RETRY_CAP_MS).catch(() => null).finally(() => { if (current) setPlansChecked(true); });
    return () => { current = false; };
  }, [offering, refreshOffering]));
  async function continueOrRetry() {
    if (checkingPlans) return;
    if (!offering) {
      if (retryInFlight.current) return;
      retryInFlight.current = true;
      const isCurrent = begin();
      setPlansChecked(false);
      try { await withinMs(refreshOffering(), OFFERING_RETRY_CAP_MS); } catch { /* The retry button remains available. */ }
      finally { retryInFlight.current = false; if (isCurrent()) setPlansChecked(true); }
      return;
    }
    router.push('/welcome/trial-reminder');
  }
  if (entitled === true || (offering && introEligibilityReady && !trial)) return <Redirect href="/welcome/payment" />;
  return <WelcomeScreen progress={1} title={trial ? 'We want you to try Fitsy for free.' : 'Checking your available plans.'}
    subtitle={trial ? 'See how good eating out can feel when it fits your goals.' : 'Your available plans will appear next.'}
    continueLabel={checkingPlans ? 'Checking plans…' : offering ? 'Continue' : 'Retry plans'} canContinue={!checkingPlans}
    onContinue={() => { void continueOrRetry(); }}>
    <TrialArtwork />
    <Text style={s.note} testID="trial-offer-note">{!offering && plansChecked ? 'Plans could not load. Check your connection and retry to see any eligible trial.' : trial ? `An eligible plan includes ${trial} free. Review your plan and renewal price before starting.` : 'Checking current plans and trial eligibility…'}</Text>
  </WelcomeScreen>;
}
const s = StyleSheet.create({ note: { ...TEXT.bodySmall, color: EDITORIAL.textMid, textAlign: 'center', lineHeight: 21 } });
