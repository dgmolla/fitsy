import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { EDITORIAL, FONTS, TEXT } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { usePurchases } from '@/lib/usePurchases';
import { purchaseTerms } from '@/lib/purchaseTerms';


export default function TrialScreen() {
  const { offering, introEligibility } = usePurchases();
  const annual = offering?.annual;
  const terms = purchaseTerms(annual?.product, annual ? introEligibility[annual.product.identifier] : false);
  const steps = terms?.trial ? [
    { title: 'Start your free trial', desc: 'After you confirm your plan, find meals that fit your macros.' },
    { title: 'Make it yours', desc: 'Save favorites. Try new dishes. Adjust your targets anytime.' },
    { title: `After ${terms.trial}`, desc: `${terms.recurring} for the annual plan, unless you cancel before billing.` },
  ] : [
    { title: 'Discover meals nearby', desc: '' },
    { title: 'Match your macro targets', desc: '' },
    { title: 'Save meals you love', desc: '' },
  ];
  useEffect(() => {
    trackOnboardingScreenView('trial');
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Top bar */}
        <View style={s.topBar}>
          <Pressable onPress={() => { if (router.canGoBack()) router.back(); else router.navigate('/welcome/notification-permission'); }} style={s.close} accessibilityRole="button" accessibilityLabel="Go back" testID="trial-back">
            <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
          </Pressable>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round((17 / 18) * 100)}%` }]} />
          </View>
        </View>

        {/* Hero */}
        <Animated.Text entering={FadeInDown.duration(500)} style={s.hero} testID="trial-title">
          {terms?.trial ? `${terms.trial} to find\nyour kind of meal.` : 'More eating out.\nLess guesswork.'}
        </Animated.Text>
        <Animated.Text entering={FadeInDown.duration(500).delay(100)} style={s.subtitle}>
          {terms?.trial ? 'Try Fitsy Pro with your next meal out.' : 'Your macros. Your appetite.\nFind room for both.'}
        </Animated.Text>

        {/* Timeline */}
        <View style={s.timeline}>
          {steps.map((step, i) => (
            <Animated.View
              key={step.title}
              entering={FadeInDown.duration(400).delay(200 + i * 100)}
              style={s.step}
            >
              <View style={s.stepLeft}>
                <View style={[s.dot, i === 0 && s.dotActive]}>
                  {terms?.trial ? <Text style={[s.number, i === 0 && s.numberActive]}>{i + 1}</Text> : <Ionicons name="checkmark" size={16} color={i === 0 ? EDITORIAL.cream : EDITORIAL.greenAccent} />}
                </View>
                {!!terms?.trial && i < steps.length - 1 && <View style={s.line} />}
              </View>
              <View style={s.stepContent}>
                <Text style={s.stepTitle}>{step.title}</Text>
                {!!step.desc && <Text style={s.stepDesc} testID={`trial-step-${i + 1}`}>{step.desc}</Text>}
              </View>
            </Animated.View>
          ))}
        </View>

        {!!terms?.trial && <Text style={s.legal}>Cancel in subscription settings at least 24 hours before your free trial ends.</Text>}

        <View style={{ flex: 1 }} />

        {/* CTA */}
        <Animated.View entering={FadeIn.duration(400).delay(500)} style={s.footer}>
          <Text style={s.next}>{terms?.trial ? 'Your plan and full terms come next.' : 'Choose your plan next.\nYou’ll see the price before subscribing.'}</Text>
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
  content: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 16 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
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

  hero: { ...TEXT.headline, fontSize: 37, lineHeight: 41, letterSpacing: -0.8, marginTop: 28 },
  subtitle: { ...TEXT.subtitle, fontSize: 15, lineHeight: 22, marginTop: 15, marginBottom: 36 },

  timeline: { gap: 0 },
  step: { flexDirection: 'row', gap: 16 },
  stepLeft: { alignItems: 'center', width: 36 },
  dot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: EDITORIAL.greenAccentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: { backgroundColor: EDITORIAL.green },
  line: {
    width: 1,
    flex: 1,
    backgroundColor: EDITORIAL.border,
    marginVertical: 4,
  },
  stepContent: { flex: 1, paddingBottom: 28 },
  stepTitle: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 17,
    lineHeight: 23,
    color: EDITORIAL.text,
    marginBottom: 4,
  },
  stepDesc: { ...TEXT.bodySmall, fontSize: 14, lineHeight: 21, color: EDITORIAL.textMid },

  legal: {
    ...TEXT.bodySmall,
    fontSize: 12,
    lineHeight: 18,
    color: EDITORIAL.textMid,
    marginTop: 4,
  },

  number: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 13, color: EDITORIAL.green },
  numberActive: { color: EDITORIAL.cream },
  next: { ...TEXT.bodySmall, textAlign: 'center', marginBottom: 17 },
  footer: { alignItems: 'center', paddingTop: 32 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    borderRadius: 32,
    minHeight: 54,
    paddingVertical: 14,
    paddingHorizontal: 16,
    width: '100%',
  },
  ctaTxt: { ...TEXT.cta, fontSize: 15, lineHeight: 22, flexShrink: 1, textAlign: 'center' },
});
