import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, FONTS } from '@/lib/brand';

const STEPS = [
  { num: '1', title: 'Set your targets', desc: "We'll ask some questions and suggest targets, but you can tweak them too", color: '#3A7050' },
  { num: '2', title: 'Search nearby', desc: 'Search restaurants that match your numbers', color: '#8B6914' },
  { num: '3', title: 'Skip the cooking', desc: 'Eat out without the guilt', color: '#7A4B8A' },
];

export default function MacrosFitsyScreen() {
  return (
    <WelcomeScreen
      progress={6 / 15}
      title="How do macros help me eat?"
      subtitle="Instead of guessing, you set targets — and we find meals that fit."
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
            <View style={s.badge}>
              <Text style={[s.badgeTxt, { color: step.color }]}>{step.num}</Text>
            </View>
            <View style={s.cardText}>
              <Text style={s.cardTitle}>{step.title}</Text>
              <Text style={s.cardDesc}>{step.desc}</Text>
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
    fontFamily: FONTS.newsreaderBold,
    fontSize: 28,
  },
  cardText: { flex: 1 },
  cardTitle: {
    fontFamily: FONTS.newsreaderBold,
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
