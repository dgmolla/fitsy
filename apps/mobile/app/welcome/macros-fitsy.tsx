import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { EDITORIAL, FONTS, TEXT } from '@/lib/brand';

const STEPS = [
  { num: '1', title: 'We help set your targets' },
  { num: '2', title: 'We scan nearby menus' },
  { num: '3', title: 'You pick and eat' },
];

export default function MacrosFitsyScreen() {
  useEffect(() => {
    trackOnboardingScreenView('macros_fitsy');
  }, []);

  return (
    <WelcomeScreen
      progress={6 / 15}
      title={"How do we pick\nthe restaurants?"}
      subtitle="Three steps — and you only have to do one of them."
      onContinue={() => router.push('/welcome/goal')}
      canContinue={true}
      continueLabel="Let's set my macros"
    >
      <View style={s.cards}>
        {STEPS.map((step, i) => (
          <Animated.View
            key={step.title}
            entering={FadeInDown.duration(400).delay(100 + i * 80)}
            style={s.card}
          >
            <View style={s.watermarkWrap}>
              <Text style={s.watermark}>{step.num}</Text>
            </View>
            <Text style={s.cardTitle}>{step.title}</Text>
          </Animated.View>
        ))}
      </View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  cards: { gap: 18 },
  card: {
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 14,
    paddingVertical: 26,
    paddingHorizontal: 22,
    position: 'relative',
    overflow: 'hidden',
  },
  watermarkWrap: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  watermark: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 42,
    color: '#D0C7B8',
    lineHeight: 42,
    includeFontPadding: false,
    opacity: 0.5,
  },
  cardTitle: TEXT.optionLabel,
});
