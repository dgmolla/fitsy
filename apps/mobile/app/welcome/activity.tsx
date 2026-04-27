import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { saveOnboardingField, type ActivityLevel } from '@/lib/onboardingStorage';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { EDITORIAL, FONTS } from '@/lib/brand';

const OPTIONS: { id: ActivityLevel; label: string; desc: string; days: string }[] = [
  { id: 'sedentary', label: 'Low', desc: 'Mostly sitting, occasional walks', days: '0–1' },
  { id: 'lightly_active', label: 'Light', desc: 'A few workouts or active commute', days: '1–3' },
  { id: 'active', label: 'Moderate', desc: 'Regular gym sessions or sports', days: '3–5' },
  { id: 'very_active', label: 'Intense', desc: 'Training almost every day', days: '6–7' },
];

export default function ActivityScreen() {
  const [selected, setSelected] = useState<ActivityLevel | null>(null);

  useEffect(() => {
    trackOnboardingScreenView('activity');
  }, []);

  return (
    <WelcomeScreen
      progress={11 / 15}
      title="How active are you?"
      subtitle="How many days per week are you active?"
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
                <View style={s.watermarkWrap}>
                  <Text style={[s.watermark, on && s.watermarkOn]}>{opt.days}</Text>
                </View>
                <View style={{ position: 'relative', zIndex: 1 }}>
                  <Text style={[s.label, on && s.labelOn]}>{opt.label}</Text>
                  <Text style={[s.desc, on && s.descOn]}>{opt.desc}</Text>
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
  list: { gap: 12 },
  row: {
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 22,
    position: 'relative',
    overflow: 'hidden',
  },
  rowOn: { backgroundColor: EDITORIAL.green },
  watermarkWrap: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  watermark: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 42,
    color: '#D0C7B8',
    opacity: 0.5,
    lineHeight: 42,
    includeFontPadding: false,
  },
  watermarkOn: {
    color: 'rgba(253,251,247,0.15)',
    opacity: 1,
  },
  label: {
    fontFamily: FONTS.newsreaderRegular,
    fontSize: 20,
    color: EDITORIAL.textMid,
    letterSpacing: -0.2,
  },
  labelOn: { color: EDITORIAL.cream },
  desc: { fontSize: 14, color: EDITORIAL.textSoft, marginTop: 3, fontWeight: '500' },
  descOn: { color: 'rgba(253,251,247,0.5)' },
});
