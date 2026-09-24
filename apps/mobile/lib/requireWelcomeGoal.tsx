import React, { useCallback, useState, type ComponentType } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { getOnboardingData } from './onboardingStorage';
import { hasChosenWelcomeGoal, rememberGoalReturnTo, type GoalReturnTo } from './onboardingResume';

/** Keep goal-dependent screens inactive until their saved prerequisite is known. */
export function requireWelcomeGoal(Screen: ComponentType, returnTo: GoalReturnTo): ComponentType {
  return function GoalRequiredScreen() {
    const [ready, setReady] = useState(false);
    useFocusEffect(useCallback(() => {
      let active = true;
      setReady(false);
      void getOnboardingData().then(async data => {
        if (!active) return;
        if (hasChosenWelcomeGoal(data.goal)) {
          setReady(true);
          return;
        }
        await rememberGoalReturnTo(returnTo);
        if (active) router.replace('/welcome/goal');
      }).catch(() => {
        if (active) router.replace('/welcome/goal');
      });
      return () => { active = false; setReady(false); };
    }, []));
    return ready ? <Screen /> : null;
  };
}
