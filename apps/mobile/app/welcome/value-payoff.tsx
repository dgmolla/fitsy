import React, { useEffect } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { trackOnboardingScreenView } from '@/lib/analytics';

const SKIP = ['Food logging', 'Meal prep', 'Macro math', 'Sad salads'];
const GET = ['Protein hit', 'Calories in check', 'Food you love', 'Zero guilt'];

/**
 * Value-prop screen 3 of 3 (payoff). The ease promise: Fitsy does the finding,
 * so you skip the busywork and still hit your goals. Hands off into
 * `how-it-works`.
 */
export default function ValuePayoffScreen() {
  useEffect(() => {
    trackOnboardingScreenView('value_payoff');
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={16} style={s.back} accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
          </Pressable>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round((6 / 18) * 100)}%` }]} />
          </View>
        </View>

        <Animated.Text entering={FadeInDown.duration(500)} style={s.headline}>
          Fitsy finds it.{'\n'}You just eat.
        </Animated.Text>
        <Animated.Text entering={FadeInDown.duration(500).delay(100)} style={s.body}>
          We surface the meals that fit, so you skip the busywork — and still get everything you're after.
        </Animated.Text>

        <Animated.View entering={FadeInDown.duration(400).delay(220)} style={s.io}>
          <View style={[s.col, s.colSkip]}>
            <Text style={s.colHeadSkip}>SKIP</Text>
            {SKIP.map((t) => (
              <View key={t} style={s.li}>
                <Ionicons name="close" size={13} color={EDITORIAL.textSoft} style={s.liIcon} />
                <Text style={s.liSkip}>{t}</Text>
              </View>
            ))}
          </View>
          <View style={[s.col, s.colGet]}>
            <Text style={s.colHeadGet}>STILL GET</Text>
            {GET.map((t) => (
              <View key={t} style={s.li}>
                <Ionicons name="checkmark" size={13} color="#9fe0b8" style={s.liIcon} />
                <Text style={s.liGet}>{t}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(340)} style={s.resultLine}>
          <View style={s.dot} />
          <Text style={s.resultTxt}>
            All of the payoff. <Text style={s.resultEm}>None of the chore.</Text>
          </Text>
        </Animated.View>

        <View style={{ flex: 1 }} />

        <Animated.View entering={FadeIn.duration(400).delay(460)}>
          <AnimatedPress style={s.cta} onPress={() => router.push('/welcome/how-it-works')} haptic accessibilityRole="button">
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

  io: { flexDirection: 'row', borderRadius: 20, overflow: 'hidden', backgroundColor: EDITORIAL.creamCard, marginBottom: 16 },
  col: { flex: 1, paddingVertical: 20, paddingHorizontal: 18 },
  colSkip: {},
  colGet: { backgroundColor: EDITORIAL.green },
  colHeadSkip: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: EDITORIAL.textSoft, marginBottom: 14 },
  colHeadGet: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: 'rgba(253,251,247,0.55)', marginBottom: 14 },
  li: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 11 },
  liIcon: { width: 14 },
  liSkip: { fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.textSoft, textDecorationLine: 'line-through' },
  liGet: { fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.cream },

  resultLine: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: EDITORIAL.creamCard, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: EDITORIAL.greenAccent },
  resultTxt: { flex: 1, fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.textMid, lineHeight: 20 },
  resultEm: { fontFamily: FONTS.frauncesSemiBold, color: EDITORIAL.green },

  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18 },
  ctaTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
});
