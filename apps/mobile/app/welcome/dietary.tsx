import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { saveOnboardingField } from '@/lib/onboardingStorage';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { EDITORIAL } from '@/lib/brand';

const OPTIONS = [
  'Vegan', 'Keto', 'Paleo', 'Vegetarian', 'Pescatarian',
  'Gluten-free', 'Halal', 'Kosher', 'Low-FODMAP', 'Dairy-free',
];

export default function DietaryScreen() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    trackOnboardingScreenView('dietary');
  }, []);

  function toggle(tag: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  return (
    <WelcomeScreen
      progress={12 / 15}
      title="Your rules."
      subtitle="Any dietary preferences? Select all that apply, or skip."
      onContinue={async () => {
        await saveOnboardingField('dietary', Array.from(selected));
        router.push('/welcome/tuning');
      }}
      canContinue={true}
      onSkip={() => router.push('/welcome/tuning')}
    >
      <View style={s.chips}>
        {OPTIONS.map((tag, i) => {
          const on = selected.has(tag);
          return (
            <Animated.View key={tag} entering={FadeInDown.duration(350).delay(80 + i * 30)}>
              <AnimatedPress
                style={[s.chip, on ? s.chipOn : undefined]}
                onPress={() => toggle(tag)}
                haptic
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.chipTxt, on ? s.chipTxtOn : undefined]}>{tag}</Text>
              </AnimatedPress>
            </Animated.View>
          );
        })}
      </View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 32,
    backgroundColor: EDITORIAL.creamCard,
  },
  chipOn: { backgroundColor: EDITORIAL.green },
  chipTxt: { fontSize: 15, fontWeight: '600', color: EDITORIAL.textMid },
  chipTxtOn: { color: EDITORIAL.cream },
});
