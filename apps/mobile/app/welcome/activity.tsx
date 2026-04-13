import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { saveOnboardingField, type ActivityLevel } from '@/lib/onboardingStorage';
import { EDITORIAL, FONTS } from '@/lib/brand';

const OPTIONS: { id: ActivityLevel; label: string; desc: string }[] = [
  { id: 'sedentary', label: 'Low', desc: 'Desk job, little exercise' },
  { id: 'lightly_active', label: 'Light', desc: '1–3 days per week' },
  { id: 'active', label: 'Moderate', desc: '3–5 days per week' },
  { id: 'very_active', label: 'Intense', desc: '6–7 days per week' },
];

export default function ActivityScreen() {
  const [selected, setSelected] = useState<ActivityLevel | null>(null);

  return (
    <WelcomeScreen
      progress={10 / 14}
      title="How active are you?"
      onContinue={async () => {
        if (selected) await saveOnboardingField('activity', selected);
        router.push('/welcome/dietary');
      }}
      canContinue={selected !== null}
      onSkip={() => router.push('/welcome/dietary')}
    >
      <View style={s.list}>
        {OPTIONS.map((opt, i) => {
          const on = selected === opt.id;
          return (
            <Animated.View key={opt.id} entering={FadeInDown.duration(400).delay(80 + i * 50)}>
              <AnimatedPress
                style={[s.row, on ? s.rowOn : undefined]}
                onPress={() => setSelected(opt.id)}
                haptic
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <View>
                  <Text style={[s.label, on ? s.labelOn : undefined]}>{opt.label}</Text>
                  <Text style={[s.desc, on ? s.descOn : undefined]}>{opt.desc}</Text>
                </View>
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
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
  },
  rowOn: { backgroundColor: EDITORIAL.green },
  label: { fontFamily: FONTS.newsreaderBold, fontSize: 20, color: EDITORIAL.text, letterSpacing: -0.3 },
  labelOn: { color: EDITORIAL.cream },
  desc: { fontSize: 14, color: EDITORIAL.textSoft, marginTop: 2 },
  descOn: { color: 'rgba(253,251,247,0.7)' },
});
