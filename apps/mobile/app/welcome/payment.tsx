import React, { useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pushProfileToServer } from '@/lib/profileSync';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { usePurchases } from '@/lib/usePurchases';
import { trackOnboardingCompleted, trackOnboardingScreenView } from '@/lib/analytics';

type PlanId = 'monthly' | 'yearly';
type ModalState = 'none' | 'discount' | 'goodbye';

export default function PaymentScreen() {
  const [plan, setPlan] = useState<PlanId>('yearly');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [modal, setModal] = useState<ModalState>('none');
  const { offering, purchase, restore } = usePurchases();

  // Live, store-localized prices from the current RevenueCat offering, with the
  // designed copy as a fallback while offerings load (or in Expo Go / no key).
  const annualPrice = offering?.annual?.product.priceString ?? '$39.99/yr';
  const monthlyPrice = offering?.monthly?.product.priceString ?? '$7.99/mo';
  // Exit-intent discount: a dedicated, lower-priced annual package (RevenueCat
  // package id `annual_discount`, backed by a separate ASC product
  // `fitsy_annual_discount` — 25% off, same 3-day trial). Live price with the
  // designed copy as fallback; if the package isn't configured the discount CTA
  // says so rather than silently charging full price (see handleStart).
  const discountedAnnual =
    offering?.availablePackages.find((p) => p.identifier === 'annual_discount') ?? null;
  const discountPrice = discountedAnnual?.product.priceString ?? '$29.99/yr';

  useEffect(() => {
    trackOnboardingScreenView('payment');
  }, []);

  // Onboarding completes once the user holds Pro — whether freshly purchased or
  // restored. Shared by handleStart and handleRestore.
  async function completeOnboarding(discounted = false) {
    await AsyncStorage.setItem('onboardingComplete', 'true');
    if (discounted) await AsyncStorage.setItem('discountApplied', 'true');
    pushProfileToServer();
    const d = await getOnboardingData();
    trackOnboardingCompleted({ goal: d.goal, activity_level: d.activity, has_weight: d.weightKg !== undefined, has_height: d.heightCm !== undefined });
    router.replace('/(tabs)/search');
  }

  // This screen IS the paywall — it renders Fitsy's own design and buys the
  // selected package directly through the RevenueCat SDK (no dashboard-designed
  // hosted paywall).
  async function handleStart(discounted = false) {
    // The discount CTA buys the dedicated discounted annual package; the normal
    // CTA buys the selected plan. Buying the regular annual here would charge
    // full price despite the "25% off" promise, so a missing discount package
    // is surfaced, not silently substituted.
    const pkg = discounted
      ? discountedAnnual
      : plan === 'yearly'
        ? offering?.annual
        : offering?.monthly;
    if (!pkg) {
      Alert.alert(
        'Just a moment',
        discounted
          ? "This offer isn't available right now — you can still start your free trial."
          : 'Plans are still loading — please try again.',
      );
      return;
    }
    setLoading(true);
    try {
      const isPro = await purchase(pkg, discounted ? 'onboarding_discount' : 'onboarding');
      if (!isPro) return; // cancelled or errored — stay on screen
      await completeOnboarding(discounted);
    } finally {
      setLoading(false);
    }
  }

  // Apple requires a Restore Purchases path. It lives here (the paywall) rather
  // than in-app, since a reinstalled subscriber re-runs onboarding.
  async function handleRestore() {
    setRestoring(true);
    try {
      const isPro = await restore();
      if (isPro) {
        await completeOnboarding();
      } else {
        Alert.alert('Nothing to restore', "We couldn't find an active subscription for this account.");
      }
    } finally {
      setRestoring(false);
    }
  }

  return (
    <>
      <WelcomeScreen
        title={`Try Fitsy free\nfor 3 days.`}
        subtitle="Cancel anytime. No charge until your trial ends."
        onContinue={() => handleStart(false)}
        canContinue={!loading}
        continueLabel={loading ? 'Setting up...' : 'Start Free Trial'}
        onSkip={() => setModal('discount')}
      >
        <View style={s.features}>
          <Text style={s.feature}>Find restaurants near you by macros</Text>
          <Text style={s.feature}>Tweak your targets anytime</Text>
          <Text style={s.feature}>Save meals you love</Text>
        </View>

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
                <Text style={s.planSub}>Billed yearly</Text>
              </View>
              <Text style={[s.planPrice, plan === 'yearly' && s.planPriceOn]}>{annualPrice}</Text>
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
              <Text style={[s.planPrice, plan === 'monthly' && s.planPriceOn]}>{monthlyPrice}</Text>
            </AnimatedPress>
          </Animated.View>
        </View>

        <AnimatedPress
          style={s.restore}
          onPress={handleRestore}
          disabled={restoring}
          accessibilityRole="button"
        >
          <Text style={s.restoreTxt}>{restoring ? 'Restoring…' : 'Restore purchases'}</Text>
        </AnimatedPress>
      </WelcomeScreen>

      {/* Discount modal — first skip */}
      <Modal visible={modal === 'discount'} transparent animationType="fade" onRequestClose={() => setModal('none')}>
        <View style={s.overlay}>
          <Animated.View entering={FadeIn.duration(300)} style={s.modal}>
            <Text style={s.modalTitle}>Wait — 25% off.</Text>
            <Text style={s.modalBody}>
              Lock in <Text style={{ fontWeight: '700' }}>{discountPrice}</Text> if you start your free trial now.
            </Text>
            <AnimatedPress style={s.modalCta} onPress={() => { setModal('none'); handleStart(true); }} haptic>
              <Text style={s.modalCtaTxt}>Claim 25% Off</Text>
            </AnimatedPress>
            <AnimatedPress style={s.modalSkip} onPress={() => setModal('goodbye')}>
              <Text style={s.modalSkipTxt}>No thanks</Text>
            </AnimatedPress>
          </Animated.View>
        </View>
      </Modal>

      {/* Goodbye screen — second skip */}
      <Modal visible={modal === 'goodbye'} transparent animationType="fade" onRequestClose={() => setModal('none')}>
        <View style={s.overlay}>
          <Animated.View entering={FadeIn.duration(300)} style={s.modal}>
            <Text style={s.goodbyeTitle}>We're sorry to{'\n'}see you go.</Text>
            <Text style={s.modalBody}>
              Fitsy requires a subscription to access personalized restaurant recommendations. You can start a free trial anytime.
            </Text>
            <AnimatedPress style={s.modalCta} onPress={() => { setModal('none'); handleStart(false); }} haptic>
              <Text style={s.modalCtaTxt}>Start Free Trial</Text>
            </AnimatedPress>
            <AnimatedPress style={s.modalSkip} onPress={() => { setModal('none'); router.replace('/welcome/problem'); }}>
              <Text style={s.modalSkipTxt}>Maybe later</Text>
            </AnimatedPress>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  features: { gap: 14, marginBottom: 40 },
  feature: { fontFamily: FONTS.nunitoSans, fontSize: 15, color: EDITORIAL.textSoft, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: EDITORIAL.border },
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
  restore: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  restoreTxt: { fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.textSoft },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planName: { fontFamily: FONTS.frauncesDisplay, fontSize: 18, color: EDITORIAL.text },
  planNameOn: { color: EDITORIAL.cream },
  planSub: { fontFamily: FONTS.nunitoSans, fontSize: 13, color: EDITORIAL.textSoft, marginTop: 2 },
  badge: { backgroundColor: 'rgba(253,251,247,0.2)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 10, fontWeight: '700', color: EDITORIAL.cream, letterSpacing: 0.5 },
  planPrice: { fontFamily: FONTS.frauncesDisplay, fontSize: 17, color: EDITORIAL.text },
  planPriceOn: { color: EDITORIAL.cream },

  overlay: { flex: 1, backgroundColor: 'rgba(15,31,21,0.55)', justifyContent: 'center', padding: 36 },
  modal: { backgroundColor: EDITORIAL.cream, borderRadius: 28, padding: 36, alignItems: 'center', gap: 16 },
  modalTitle: { fontFamily: FONTS.frauncesDisplay, fontSize: 30, color: EDITORIAL.text, letterSpacing: -1 },
  goodbyeTitle: { fontFamily: FONTS.frauncesDisplay, fontSize: 28, color: EDITORIAL.text, letterSpacing: -0.8, textAlign: 'center' },
  modalBody: { fontFamily: FONTS.nunitoSans, fontSize: 16, lineHeight: 24, color: EDITORIAL.textSoft, textAlign: 'center' },
  modalCta: { backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18, width: '100%', alignItems: 'center', marginTop: 8 },
  modalCtaTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  modalSkip: { paddingVertical: 8 },
  modalSkipTxt: { fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.textSoft },
});
