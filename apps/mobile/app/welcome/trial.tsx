import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { TrialArtwork } from '@/components/TrialArtwork';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { usePurchases } from '@/lib/usePurchases';
import { purchaseTerms } from '@/lib/purchaseTerms';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { trackOnboardingScreenView } from '@/lib/analytics';

export default function TrialScreen() {
  const focused = useIsFocused();
  useOnboardingStep('trial');
  const { offering, introEligibility, refreshOffering, entitled } = usePurchases();
  const offers = [offering?.annual, offering?.monthly].map(pkg => purchaseTerms(pkg?.product, pkg ? introEligibility[pkg.product.identifier] : undefined));
  const trial = offers.find(terms => terms?.trial)?.trial;
  useEffect(() => { if (focused && entitled === true) router.replace('/welcome/payment'); }, [focused, entitled]);
  useEffect(() => { trackOnboardingScreenView('trial'); }, []);
  useEffect(() => { if (!offering) void refreshOffering(); }, [offering, refreshOffering]);
  return <WelcomeScreen progress={1} title={trial ? 'We want you to try Fitsy for free.' : 'Find your next meal with Fitsy.'}
    subtitle={trial ? 'See how good eating out can feel when it fits your goals.' : 'More meals that fit your goals, wherever the day takes you.'}
    continueLabel="Continue" canContinue onContinue={() => router.push('/welcome/trial-reminder')}>
    <TrialArtwork />
    <Text style={s.note} testID="trial-offer-note">{trial ? `An eligible plan includes ${trial} free. Review your plan and renewal price before starting.` : 'Review current plans and any eligible trial on the next screens. Your subscription starts only when you confirm.'}</Text>
  </WelcomeScreen>;
}
const s = StyleSheet.create({ note: { ...TEXT.bodySmall, color: EDITORIAL.textMid, textAlign: 'center', lineHeight: 21 } });
