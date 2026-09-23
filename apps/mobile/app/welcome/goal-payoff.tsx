import React, { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { OnboardingGoalGraph } from '@/components/OnboardingGoalGraph';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { getOnboardingData, type OnboardingData } from '@/lib/onboardingStorage';
import { onboardingGoalStory } from '@/lib/onboardingPersonalization';
import { trackOnboardingScreenView } from '@/lib/analytics';

export default function GoalPayoffScreen() {
  useOnboardingStep('goal-payoff');
  const [data, setData] = useState<OnboardingData>();
  useFocusEffect(useCallback(() => {
    let live = true;
    void getOnboardingData().then(saved => {
      if (!live) return;
      if (!saved.goal) {
        setData(undefined);
        router.replace('/welcome/goal');
        return;
      }
      setData(saved);
      trackOnboardingScreenView(`goal_payoff_${saved.goal}`);
    });
    return () => { live = false; };
  }, []));
  if (!data?.goal) return null;
  const story = onboardingGoalStory(data?.goal);
  return <WelcomeScreen progress={0.4} title={story.title} subtitle={story.body}
    canContinue onContinue={() => router.push('/welcome/target-setup')} continueLabel="Set my meal targets">
    <OnboardingGoalGraph goal={data.goal} />
  </WelcomeScreen>;
}
