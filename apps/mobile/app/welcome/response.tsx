import React, { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { OnboardingApproachStory } from '@/components/OnboardingApproachStory';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { onboardingPitch } from '@/lib/onboardingPersonalization';
import { trackOnboardingScreenView } from '@/lib/analytics';

export default function ResponseScreen() {
  useOnboardingStep('response');
  const [pitch, setPitch] = useState<ReturnType<typeof onboardingPitch>>();
  useFocusEffect(useCallback(() => {
    let live = true;
    void getOnboardingData().then(data => {
      if (!live) return;
      setPitch(onboardingPitch(data.tried));
      trackOnboardingScreenView(`response_${data.tried ?? 'nothing'}`);
    });
    return () => { live = false; };
  }, []));
  return <WelcomeScreen progress={0.29} title={pitch?.headline ?? 'Made for your meals.'} subtitle={pitch?.body}
    canContinue={!!pitch} onContinue={() => router.push('/welcome/value-payoff')} continueLabel="Show me how">
    {pitch && <OnboardingApproachStory approach={pitch.approach} />}
  </WelcomeScreen>;
}
