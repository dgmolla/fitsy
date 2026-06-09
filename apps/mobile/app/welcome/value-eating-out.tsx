import React, { useEffect } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { trackOnboardingScreenView } from '@/lib/analytics';

/**
 * Value-prop screen 1 of 3 (reframe). Eating out is normal — the gap is not
 * knowing what's in the food. Sets up the discovery payoff on the next two
 * screens. Sits between `response` and `value-abundance`.
 */
export default function ValueEatingOutScreen() {
  useEffect(() => {
    trackOnboardingScreenView('value_eating_out');
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={16} style={s.back} accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
          </Pressable>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round((4 / 18) * 100)}%` }]} />
          </View>
        </View>

        <Animated.Text entering={FadeInDown.duration(500)} style={s.headline}>
          Eating out{'\n'}isn't the problem.
        </Animated.Text>

        <Animated.Text entering={FadeInDown.duration(500).delay(100)} style={s.body}>
          We all eat out — 4–5× a week, on average. The hard part has never been the eating. It's not knowing what's actually in the food.
        </Animated.Text>

        <Animated.View entering={FadeInDown.duration(400).delay(220)} style={s.statCard}>
          <Text style={s.statNum}>4–5×</Text>
          <Text style={s.statUnit}>meals out, every week</Text>
          <Text style={s.statSrc}>— and that's not changing</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(320)} style={s.calloutCard}>
          <Text style={s.calloutText}>
            You're not making bad choices. You're making <Text style={s.calloutEm}>blind</Text> ones.
          </Text>
        </Animated.View>

        <View style={{ flex: 1 }} />

        <Animated.View entering={FadeIn.duration(400).delay(440)}>
          <AnimatedPress style={s.cta} onPress={() => router.push('/welcome/value-abundance')} haptic accessibilityRole="button">
            <Text style={s.ctaTxt}>Continue</Text>
            <Ionicons name="arrow-forward" size={15} color={EDITORIAL.cream} />
          </AnimatedPress>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flex: 1, paddingHorizontal: 36, paddingBottom: 40 },

  topBar: { flexDirection: 'row', alignItems: 'center', height: 52 },
  back: { width: 44, height: 44, justifyContent: 'center' },
  progressTrack: { flex: 1, height: 4, backgroundColor: EDITORIAL.border, borderRadius: 2, marginLeft: 12, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: EDITORIAL.greenAccent, borderRadius: 2 },

  headline: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 30, color: EDITORIAL.text, letterSpacing: -1.2, lineHeight: 38,
    marginBottom: 16, marginTop: 8,
  },
  body: { fontFamily: FONTS.nunitoSans, fontSize: 16, lineHeight: 24, color: EDITORIAL.textSoft, marginBottom: 24 },

  statCard: { backgroundColor: EDITORIAL.creamCard, borderRadius: 20, paddingVertical: 26, paddingHorizontal: 24, alignItems: 'center', marginBottom: 18 },
  statNum: { fontFamily: FONTS.frauncesDisplay, fontSize: 56, color: EDITORIAL.green, letterSpacing: -2, lineHeight: 58 },
  statUnit: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 14, fontWeight: '600', color: EDITORIAL.textMid, marginTop: 8 },
  statSrc: { fontFamily: FONTS.nunitoSans, fontSize: 11, color: EDITORIAL.textSoft, marginTop: 4 },

  calloutCard: { backgroundColor: EDITORIAL.green, borderRadius: 20, paddingVertical: 22, paddingHorizontal: 24 },
  calloutText: { fontFamily: FONTS.frauncesDisplay, fontSize: 18, color: EDITORIAL.cream, letterSpacing: -0.3, lineHeight: 26 },
  calloutEm: { fontFamily: FONTS.frauncesItalic, fontStyle: 'italic', color: '#9fe0b8' },

  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18 },
  ctaTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
});
