import React, { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pushProfileToServer } from '@/lib/profileSync';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { trackOnboardingCompleted } from '@/lib/analytics';

type PlanId = 'monthly' | 'yearly';

export default function PaymentScreen() {
  const [plan, setPlan] = useState<PlanId>('yearly');
  const [loading, setLoading] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);

  async function handleStart(discounted = false) {
    setLoading(true);
    try {
      await AsyncStorage.setItem('onboardingComplete', 'true');
      if (discounted) await AsyncStorage.setItem('discountApplied', 'true');
      pushProfileToServer();
      const d = await getOnboardingData();
      trackOnboardingCompleted({ goal: d.goal, activity_level: d.activity, has_weight: d.weightKg !== undefined, has_height: d.heightCm !== undefined });
      router.push('/welcome/signin');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <WelcomeScreen
        title={`Try Fitsy free\nfor 7 days.`}
        subtitle="Cancel anytime. No charge until your trial ends."
        onContinue={() => handleStart(false)}
        canContinue={!loading}
        continueLabel={loading ? 'Setting up...' : 'Start Free Trial'}
        onSkip={() => setShowDiscount(true)}
      >
        <View style={s.plans}>
          <Animated.View entering={FadeInDown.duration(400).delay(100)}>
            <AnimatedPress
              style={[s.plan, plan === 'yearly' && s.planOn]}
              onPress={() => setPlan('yearly')}
              haptic
              accessibilityRole="button"
              accessibilityState={{ selected: plan === 'yearly' }}
            >
              <View>
                <View style={s.planRow}>
                  <Text style={[s.planName, plan === 'yearly' && s.planNameOn]}>Annual</Text>
                  <View style={s.badge}><Text style={s.badgeTxt}>Best Value</Text></View>
                </View>
                <Text style={s.planSub}>$2.50 / mo</Text>
              </View>
              <Text style={[s.planPrice, plan === 'yearly' && s.planPriceOn]}>$29.99/yr</Text>
            </AnimatedPress>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(400).delay(180)}>
            <AnimatedPress
              style={[s.plan, plan === 'monthly' && s.planOn]}
              onPress={() => setPlan('monthly')}
              haptic
              accessibilityRole="button"
              accessibilityState={{ selected: plan === 'monthly' }}
            >
              <Text style={[s.planName, plan === 'monthly' && s.planNameOn]}>Monthly</Text>
              <Text style={[s.planPrice, plan === 'monthly' && s.planPriceOn]}>$4.99/mo</Text>
            </AnimatedPress>
          </Animated.View>
        </View>
      </WelcomeScreen>

      {/* Discount modal */}
      <Modal visible={showDiscount} transparent animationType="fade" onRequestClose={() => setShowDiscount(false)}>
        <View style={s.overlay}>
          <Animated.View entering={FadeIn.duration(300)} style={s.modal}>
            <Text style={s.modalTitle}>Wait — 50% off.</Text>
            <Text style={s.modalBody}>
              Lock in <Text style={{ fontWeight: '700' }}>$14.99/year</Text> if you start your free trial now.
            </Text>
            <AnimatedPress style={s.modalCta} onPress={() => { setShowDiscount(false); handleStart(true); }} haptic>
              <Text style={s.modalCtaTxt}>Claim 50% Off</Text>
            </AnimatedPress>
            <AnimatedPress style={s.modalSkip} onPress={() => { setShowDiscount(false); handleStart(false); }}>
              <Text style={s.modalSkipTxt}>No thanks</Text>
            </AnimatedPress>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  plans: { gap: 12 },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 18,
    padding: 22,
  },
  planOn: { backgroundColor: EDITORIAL.green },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planName: { fontFamily: FONTS.newsreaderBold, fontSize: 18, color: EDITORIAL.text },
  planNameOn: { color: EDITORIAL.cream },
  planSub: { fontSize: 13, color: EDITORIAL.textSoft, marginTop: 2 },
  badge: { backgroundColor: 'rgba(253,251,247,0.2)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { fontSize: 10, fontWeight: '700', color: EDITORIAL.cream, letterSpacing: 0.5 },
  planPrice: { fontFamily: FONTS.newsreaderBold, fontSize: 17, color: EDITORIAL.text },
  planPriceOn: { color: EDITORIAL.cream },

  overlay: { flex: 1, backgroundColor: 'rgba(15,31,21,0.55)', justifyContent: 'center', padding: 36 },
  modal: { backgroundColor: EDITORIAL.cream, borderRadius: 28, padding: 36, alignItems: 'center', gap: 16 },
  modalTitle: { fontFamily: FONTS.newsreaderBold, fontSize: 30, color: EDITORIAL.text, letterSpacing: -1 },
  modalBody: { fontSize: 16, lineHeight: 24, color: EDITORIAL.textSoft, textAlign: 'center' },
  modalCta: { backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18, width: '100%', alignItems: 'center', marginTop: 8 },
  modalCtaTxt: { fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  modalSkip: { paddingVertical: 8 },
  modalSkipTxt: { fontSize: 14, color: EDITORIAL.textSoft },
});
