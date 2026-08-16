import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { getOnboardingData, saveOnboardingField, type Sex } from '@/lib/onboardingStorage';
import { trackOnboardingChoiceSelected, trackOnboardingScreenView } from '@/lib/analytics';
import { EDITORIAL, FONTS } from '@/lib/brand';

const OPTIONS: { id: Sex; label: string }[] = [
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
];

export default function SexScreen() {
  const [selected, setSelected] = useState<Sex | null>(null);

  useEffect(() => {
    trackOnboardingScreenView('sex');
  }, []);

  useEffect(() => {
    (async () => {
      const data = await getOnboardingData();
      if (data.sex) setSelected(data.sex);
    })();
  }, []);

  return (
    <WelcomeScreen
      progress={13.5 / 18}
      title="What's your biological sex?"
      subtitle="Used to calculate your metabolic rate more accurately."
      onContinue={async () => {
        if (selected) await saveOnboardingField('sex', selected);
        router.push('/welcome/activity');
      }}
      canContinue={selected !== null}
      onSkip={() => router.push('/welcome/activity')}
    >
      <View style={s.list}>
        {OPTIONS.map((o, i) => {
          const on = selected === o.id;
          return (
            <Animated.View key={o.id} entering={FadeInDown.duration(400).delay(100 + i * 60)}>
              <AnimatedPress
                style={[s.row, on ? s.rowOn : undefined]}
                onPress={() => {
                  setSelected(o.id);
                  trackOnboardingChoiceSelected({ screen: 'sex', value: o.id });
                }}
                haptic
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.label, on ? s.labelOn : undefined]}>{o.label}</Text>
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
