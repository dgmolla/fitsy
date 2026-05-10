import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { EDITORIAL, FONTS } from '@/lib/brand';

const MACROS = [
  { label: 'Protein', abbr: 'P', desc: 'Builds and repairs muscle', color: '#3A7050' },
  { label: 'Carbs', abbr: 'C', desc: "Your body's main energy source", color: '#8B6914' },
  { label: 'Fat', abbr: 'F', desc: 'Supports hormones and brain function', color: '#7A4B8A' },
];

export default function MacrosIntroScreen() {
  useEffect(() => {
    trackOnboardingScreenView('macros_intro');
  }, []);

  return (
    <WelcomeScreen
      progress={6 / 15}
      title="What are macros?"
      subtitle="Every meal breaks down into three macronutrients. Knowing yours helps you eat smarter."
      onContinue={() => router.push('/welcome/macros-fitsy')}
      canContinue={true}
    >
      <View style={s.cards}>
        {MACROS.map((m, i) => (
          <Animated.View
            key={m.label}
            entering={FadeInDown.duration(400).delay(100 + i * 80)}
            style={s.card}
          >
            <View style={s.badge}>
              <Text style={[s.badgeTxt, { color: m.color }]}>{m.abbr}</Text>
            </View>
            <View style={s.cardText}>
              <Text style={s.cardTitle}>{m.label}</Text>
              <Text style={s.cardDesc}>{m.desc}</Text>
            </View>
          </Animated.View>
        ))}
      </View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  cards: { gap: 14 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 14,
  },
  badge: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTxt: {
    fontFamily: FONTS.frauncesBold,
    fontSize: 28,
  },
  cardText: { flex: 1 },
  cardTitle: {
    fontFamily: FONTS.frauncesBold,
    fontSize: 18,
    color: EDITORIAL.text,
    letterSpacing: -0.2,
  },
  cardDesc: {
    fontSize: 14,
    color: EDITORIAL.textSoft,
    marginTop: 2,
  },
});
