import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';

export default function PromiseScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.spacer} />

        <Animated.Text entering={FadeInDown.duration(600)} style={s.headline}>
          We find restaurants{'\n'}with meals that hit{'\n'}your targets.
        </Animated.Text>

        {/* Mock search result */}
        <Animated.View entering={FadeInDown.duration(500).delay(200)} style={s.card}>
          <Text style={s.cardIdx}>01</Text>
          <Text style={s.cardName}>Pine and Crane</Text>
          <Text style={s.cardDish}>Example meal</Text>
          <View style={s.cardMacros}>
            <Text style={s.cardMacro}>P 32g</Text>
            <Text style={s.cardDot}>·</Text>
            <Text style={s.cardMacro}>C 60g</Text>
            <Text style={s.cardDot}>·</Text>
            <Text style={s.cardMacro}>F 20g</Text>
            <Text style={s.cardDot}>·</Text>
            <Text style={s.cardCal}>580 kcal</Text>
          </View>
        </Animated.View>

        <View style={s.spacer} />

        <Animated.View entering={FadeInDown.duration(500).delay(400)}>
          <AnimatedPress
            style={s.cta}
            onPress={() => router.push('/welcome/goal')}
            haptic
            accessibilityRole="button"
          >
            <Text style={s.ctaTxt}>Let's personalize</Text>
            <Ionicons name="arrow-forward" size={16} color={EDITORIAL.cream} />
          </AnimatedPress>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flex: 1, paddingHorizontal: 36, paddingBottom: 48 },
  spacer: { flex: 1 },

  headline: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 28,
    color: EDITORIAL.text,
    letterSpacing: -1,
    lineHeight: 40,
    marginBottom: 36,
  },

  card: {
    backgroundColor: EDITORIAL.green,
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 24,
    gap: 4,
  },
  cardIdx: { fontSize: 11, fontWeight: '800', color: 'rgba(253,251,247,0.35)', letterSpacing: 1 },
  cardName: { fontFamily: FONTS.newsreaderBold, fontSize: 22, color: EDITORIAL.cream, letterSpacing: -0.3 },
  cardDish: { fontFamily: FONTS.newsreaderItalic, fontSize: 15, color: 'rgba(253,251,247,0.7)' },
  cardMacros: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  cardMacro: { fontSize: 12, fontWeight: '600', color: 'rgba(253,251,247,0.5)' },
  cardDot: { fontSize: 12, color: 'rgba(253,251,247,0.25)' },
  cardCal: { fontSize: 12, fontWeight: '700', color: 'rgba(253,251,247,0.8)' },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    borderRadius: 32,
    paddingVertical: 18,
  },
  ctaTxt: { fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
});
