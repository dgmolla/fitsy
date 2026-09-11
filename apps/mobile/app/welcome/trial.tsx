import React, { useEffect } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { EDITORIAL, FONTS, TEXT } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { usePurchases } from '@/lib/usePurchases';
import { purchaseTerms } from '@/lib/purchaseTerms';

const STEPS = [
  {
    icon: 'lock-open-outline' as const,
    title: 'Find a meal you’ll enjoy',
    desc: 'See nearby restaurant meals matched to your macros and preferences.',
  },
  {
    icon: 'notifications-outline' as const,
    title: 'Choose the plan that fits',
    desc: 'Review the current price and any eligible trial before confirming in the store.',
  },
  {
    icon: 'star-outline' as const,
    title: 'Stay in control',
    desc: 'Subscriptions renew automatically. Manage or cancel in your subscription settings at least 24 hours before renewal.',
  },
];

export default function TrialScreen() {
  const { offering, introEligibility } = usePurchases();
  const annual = offering?.annual;
  const terms = purchaseTerms(annual?.product, annual ? introEligibility[annual.product.identifier] : false);
  useEffect(() => {
    trackOnboardingScreenView('trial');
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Top bar */}
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={16} style={s.close} accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
          </Pressable>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round((17 / 18) * 100)}%` }]} />
          </View>
        </View>

        {/* Hero */}
        <Animated.Text entering={FadeInDown.duration(500)} style={s.hero}>
          {terms?.trial ? `${terms.trial} to find your fit.` : 'Make room for eating out.'}
        </Animated.Text>
        <Animated.Text entering={FadeInDown.duration(500).delay(100)} style={s.subtitle}>
          Enjoy the meal. Keep your goals.
        </Animated.Text>

        {/* Timeline */}
        <View style={s.timeline}>
          {STEPS.map((step, i) => (
            <Animated.View
              key={step.title}
              entering={FadeInDown.duration(400).delay(200 + i * 100)}
              style={s.step}
            >
              <View style={s.stepLeft}>
                <View style={[s.dot, i === 0 && s.dotActive]}>
                  <Ionicons name={step.icon} size={16} color={i === 0 ? EDITORIAL.cream : EDITORIAL.greenAccent} />
                </View>
                {i < STEPS.length - 1 && <View style={s.line} />}
              </View>
              <View style={s.stepContent}>
                <Text style={s.stepTitle}>{step.title}</Text>
                <Text style={s.stepDesc}>{step.desc}</Text>
              </View>
            </Animated.View>
          ))}
        </View>

        <Animated.Text entering={FadeIn.duration(400).delay(600)} style={s.legal}>
          {terms?.disclosure ?? 'Your selected plan’s current price and terms will appear before purchase.'}
        </Animated.Text>

        <View style={{ flex: 1 }} />

        {/* CTA */}
        <Animated.View entering={FadeIn.duration(400).delay(500)} style={s.footer}>
          <AnimatedPress
            style={s.cta}
            onPress={() => router.push('/welcome/payment')}
            haptic
            accessibilityRole="button"
            testID="trial-see-plans"
          >
            <Text style={s.ctaTxt}>See plans for meals that fit</Text>
            <Ionicons name="arrow-forward" size={15} color={EDITORIAL.cream} />
          </AnimatedPress>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flexGrow: 1, paddingHorizontal: 32, paddingBottom: 20 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
  },
  close: { width: 44, height: 44, justifyContent: 'center' },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: EDITORIAL.border,
    borderRadius: 2,
    marginLeft: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: EDITORIAL.greenAccent,
    borderRadius: 2,
  },

  hero: { ...TEXT.headline, marginTop: 8 },
  subtitle: { ...TEXT.subtitle, marginTop: 10, marginBottom: 40 },

  timeline: { gap: 0 },
  step: { flexDirection: 'row', gap: 16 },
  stepLeft: { alignItems: 'center', width: 36 },
  dot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: EDITORIAL.creamCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: { backgroundColor: EDITORIAL.green },
  line: {
    width: 2,
    flex: 1,
    backgroundColor: EDITORIAL.border,
    marginVertical: 4,
  },
  stepContent: { flex: 1, paddingBottom: 28 },
  stepTitle: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 16,
    color: EDITORIAL.text,
    marginBottom: 4,
  },
  stepDesc: { ...TEXT.bodySmall, color: EDITORIAL.textSoft },

  legal: {
    ...TEXT.bodySmall,
    fontSize: 12,
    lineHeight: 18,
    color: EDITORIAL.textSoft,
    textAlign: 'center',
    marginTop: 16,
  },

  footer: { alignItems: 'center' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    borderRadius: 32,
    paddingVertical: 18,
    width: '100%',
  },
  ctaTxt: { ...TEXT.cta, fontSize: 16 },
});
