import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { TrialArtwork } from '@/components/TrialArtwork';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { usePurchases } from '@/lib/usePurchases';
import { purchaseTerms } from '@/lib/purchaseTerms';
import { defaultTrialPlan, trialPresentation } from '@/lib/trialPresentation';
import { devTrialVisualOffer } from '@/lib/devTrialVisualOffer';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { withinMs } from '@/lib/async';
import { useRouteContinuation } from '@/lib/useRouteContinuation';

const OFFERING_RETRY_CAP_MS = 5000;

export default function TrialScreen() {
  const { devTrialVisual } = useLocalSearchParams<{ devTrialVisual?: string }>();
  const visualRequested = __DEV__ && devTrialVisual === '1';
  const focused = useIsFocused();
  useOnboardingStep('trial');
  const { ready, offering, introEligibility, introEligibilityReady, refreshOffering, entitled } = usePurchases();
  const visual = devTrialVisualOffer(offering, visualRequested);
  const shownOffering = visual?.offering ?? offering;
  const shownEligibility = visual?.eligibility ?? introEligibility;
  const eligibilityReady = !!visual || introEligibilityReady;
  const annual = purchaseTerms(shownOffering?.annual?.product, shownOffering?.annual ? shownEligibility[shownOffering.annual.product.identifier] : undefined);
  const monthly = purchaseTerms(shownOffering?.monthly?.product, shownOffering?.monthly ? shownEligibility[shownOffering.monthly.product.identifier] : undefined);
  const selectedPlan = defaultTrialPlan(annual, monthly);
  const trial = trialPresentation(selectedPlan === 'yearly' ? annual : monthly).trial;
  const [plansChecked, setPlansChecked] = useState(false);
  const retryInFlight = useRef(false);
  const navigating = useRef(false);
  const { begin } = useRouteContinuation();
  const checkingPlans = !ready || (shownOffering ? !eligibilityReady : !plansChecked);
  useEffect(() => { if (focused && entitled === true) router.replace('/welcome/payment'); }, [focused, entitled]);
  useEffect(() => { if (!visualRequested) trackOnboardingScreenView('trial'); }, [visualRequested]);
  useFocusEffect(useCallback(() => {
    navigating.current = false;
    if (offering) return;
    let current = true;
    setPlansChecked(false);
    void withinMs(refreshOffering(), OFFERING_RETRY_CAP_MS).catch(() => null).finally(() => { if (current) setPlansChecked(true); });
    return () => { current = false; };
  }, [offering, refreshOffering]));
  async function continueOrRetry() {
    if (checkingPlans || navigating.current) return;
    if (!offering) {
      if (retryInFlight.current) return;
      retryInFlight.current = true;
      const isCurrent = begin();
      setPlansChecked(false);
      try { await withinMs(refreshOffering(), OFFERING_RETRY_CAP_MS); } catch { /* The retry button remains available. */ }
      finally { retryInFlight.current = false; if (isCurrent()) setPlansChecked(true); }
      return;
    }
    navigating.current = true;
    router.push(visualRequested ? '/welcome/trial-reminder?devTrialVisual=1' : '/welcome/trial-reminder');
  }
  if (entitled === true || (shownOffering && eligibilityReady && !trial)) return <Redirect href="/welcome/payment" />;
  return <WelcomeScreen progress={1} title={trial ? 'Try Fitsy free' : 'Checking your plans'}
    subtitle={trial ? `Get ${trial} of Fitsy Pro with the selected ${selectedPlan === 'yearly' ? 'annual' : 'monthly'} plan.` : 'Your available plans will appear next.'}
    continueLabel={checkingPlans ? 'Checking plans…' : shownOffering ? 'Continue' : 'Retry plans'} canContinue={!checkingPlans}
    onContinue={() => { void continueOrRetry(); }}>
    <TrialArtwork />
    <Text style={s.note} testID="trial-offer-note">{visual ? 'Synthetic trial eligibility for visual testing. Live Test Store prices appear on the next screen.' : !offering && plansChecked ? 'Plans could not load. Check your connection and retry.' : trial ? 'Review the price and renewal terms before you start.' : 'Checking current plans and trial eligibility…'}</Text>
  </WelcomeScreen>;
}
const s = StyleSheet.create({ note: { ...TEXT.bodySmall, color: EDITORIAL.textMid, textAlign: 'center', lineHeight: 21 } });
