import { clearGoalReturnTo, takeGoalReturnTo, useOnboardingStep } from '@/lib/onboardingResume';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { getOnboardingData, saveOnboardingField, type Goal } from '@/lib/onboardingStorage';
import { trackOnboardingChoiceSelected, trackOnboardingScreenView } from '@/lib/analytics';
import { EDITORIAL, FONTS } from '@/lib/brand';


const GOALS: { id: Goal; label: string }[] = [
  { id: 'lose_fat', label: 'Lose weight' },
  { id: 'build_muscle', label: 'Build muscle' },
  { id: 'performance', label: 'Improve performance' },
];

export default function GoalScreen() {
  useOnboardingStep('goal');
  const navigation = useNavigation();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Goal | null>(null);

  useFocusEffect(useCallback(() => () => { void clearGoalReturnTo(); }, []));

  useEffect(() => {
    trackOnboardingScreenView('goal');
    void getOnboardingData().then(data => setSelected(GOALS.find(goal => goal.id === data.goal)?.id ?? null));
  }, []);

  return (
    <WelcomeScreen
      progress={0.18}
      title="What's your goal?"
      onBack={navigation.canGoBack() ? async () => {
        await clearGoalReturnTo();
        router.back();
      } : undefined}
      onContinue={async () => {
        if (!selected || busy) return;
        setBusy(true);
        try {
          await saveOnboardingField('goal', selected);
          const returnTo = await takeGoalReturnTo();
          if (returnTo) router.replace(returnTo);
          else router.push('/welcome/tried');
        } catch { Alert.alert('Could not save your goal', 'Please try again.'); }
        finally { setBusy(false); }
      }}
      canContinue={selected !== null && !busy}
    >
      <View style={s.list}>
        {GOALS.map((g, i) => {
          const on = selected === g.id;
          return (
            <Animated.View key={g.id} entering={FadeInDown.duration(400).delay(100 + i * 60)}>
              <AnimatedPress
                style={[s.row, on ? s.rowOn : undefined]}
                onPress={() => {
                  setSelected(g.id);
                  trackOnboardingChoiceSelected({ screen: 'goal', value: g.id });
                }}
                testID={`goal-${g.id}`}
                haptic
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.label, on ? s.labelOn : undefined]}>{g.label}</Text>
                <View style={[s.dot, on ? s.dotOn : undefined]} />
              </AnimatedPress>
            </Animated.View>
          );
        })}
      </View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  list: { gap: 10, marginTop: 'auto', marginBottom: 'auto', paddingBottom: 60 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 24,
  },
  rowOn: { backgroundColor: EDITORIAL.green },
  label: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 18,
    color: EDITORIAL.textMid,
    letterSpacing: -0.3,
  },
  labelOn: { color: EDITORIAL.cream },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: EDITORIAL.border,
  },
  dotOn: { backgroundColor: EDITORIAL.cream },
});
