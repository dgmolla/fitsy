import { requireWelcomeGoal } from '@/lib/requireWelcomeGoal';
import React, { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { OnboardingFitnessPayoff } from '@/components/OnboardingFitnessPayoff';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { onboardingPitch } from '@/lib/onboardingPersonalization';
import { trackOnboardingScreenView } from '@/lib/analytics';

function ValuePayoffScreen() {
  useOnboardingStep('value-payoff');
  const [pitch, setPitch] = useState<ReturnType<typeof onboardingPitch>>();
  useFocusEffect(useCallback(() => {
    let live = true;
    void getOnboardingData().then(data => {
      if (!live) return;
      setPitch(onboardingPitch(data.tried));
      trackOnboardingScreenView(`value_payoff_${data.tried ?? 'nothing'}`);
    });
    return () => { live = false; };
  }, []));
  return <WelcomeScreen progress={0.36} title={pitch?.payoffTitle ?? 'Meals for your goals.'} subtitle={pitch?.payoffBody}
    canContinue={!!pitch} onContinue={() => router.push('/welcome/goal-payoff')} continueLabel="Connect it to my goal">
    {pitch && <OnboardingFitnessPayoff pitch={pitch} />}
  </WelcomeScreen>;
}

export default requireWelcomeGoal(ValuePayoffScreen, '/welcome/value-payoff');
