import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';

const STEPS = [
  {
    icon: 'lock-open-outline' as const,
    title: 'Today: Full access',
    desc: 'Unlock macro-matched restaurant search, personalized targets, and confidence scores.',
  },
  {
    icon: 'notifications-outline' as const,
    title: 'Day 2: Reminder',
    desc: "We'll notify you before your trial ends. No surprises.",
  },
  {
    icon: 'star-outline' as const,
    title: 'Day 3: Trial ends',
    desc: 'Choose a plan that works for you, or cancel — no charge.',
  },
];

export default function TrialScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        {/* Close */}
        <Pressable onPress={() => router.back()} hitSlop={16} style={s.close} accessibilityRole="button">
          <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
        </Pressable>

        {/* Hero */}
        <Animated.Text entering={FadeInDown.duration(500)} style={s.hero}>
          3 days on us.
        </Animated.Text>
        <Animated.Text entering={FadeInDown.duration(500).delay(100)} style={s.subtitle}>
          Here's how your free trial works.
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
          Cancel anytime in the App Store. Terms of Service and Privacy Policy apply.
        </Animated.Text>

        <View style={{ flex: 1 }} />

        {/* CTA */}
        <Animated.View entering={FadeIn.duration(400).delay(500)} style={s.footer}>
          <AnimatedPress
            style={s.cta}
            onPress={() => router.push('/welcome/payment')}
            haptic
            accessibilityRole="button"
          >
            <Text style={s.ctaTxt}>See plans</Text>
            <Ionicons name="arrow-forward" size={15} color={EDITORIAL.cream} />
          </AnimatedPress>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flex: 1, paddingHorizontal: 32, paddingBottom: 20 },

  close: { width: 44, height: 48, justifyContent: 'center' },

  hero: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 36,
    color: EDITORIAL.text,
    letterSpacing: -1.2,
    lineHeight: 42,
    marginTop: 8,
  },
  subtitle: {
    fontSize: 16,
    color: EDITORIAL.textSoft,
    marginTop: 10,
    marginBottom: 40,
  },

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
    fontFamily: FONTS.newsreaderBold,
    fontSize: 17,
    color: EDITORIAL.text,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  stepDesc: {
    fontSize: 14,
    lineHeight: 20,
    color: EDITORIAL.textSoft,
  },

  legal: {
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
  ctaTxt: { fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
});
