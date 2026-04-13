import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { saveOnboardingField } from '@/lib/onboardingStorage';
import { EDITORIAL, FONTS } from '@/lib/brand';

type Goal = 'lose_fat' | 'maintain' | 'build_muscle' | 'explore';

const GOALS: { id: Goal; label: string }[] = [
  { id: 'lose_fat', label: 'Lose weight' },
  { id: 'build_muscle', label: 'Build muscle' },
  { id: 'maintain', label: 'Eat healthier' },
  { id: 'explore', label: 'Explore cuisines' },
];

export default function GoalScreen() {
  const [selected, setSelected] = useState<Goal | null>(null);

  return (
    <WelcomeScreen
      step={3}
      totalSteps={8}
      title="What's your goal?"
      onContinue={async () => {
        if (selected) {
          const mapped = selected === 'explore' ? 'maintain' : selected;
          await saveOnboardingField('goal', mapped);
        }
        router.push('/welcome/height');
      }}
      canContinue={selected !== null}
      onSkip={() => router.push('/welcome/height')}
    >
      <View style={s.list}>
        {GOALS.map((g, i) => {
          const on = selected === g.id;
          return (
            <Animated.View key={g.id} entering={FadeInDown.duration(400).delay(100 + i * 60)}>
              <AnimatedPress
                style={[s.row, on ? s.rowOn : undefined]}
                onPress={() => setSelected(g.id)}
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
  list: { gap: 10 },
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
    fontFamily: FONTS.newsreaderBold,
    fontSize: 18,
    color: EDITORIAL.text,
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
