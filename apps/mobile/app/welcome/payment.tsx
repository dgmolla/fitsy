import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pushProfileToServer } from '@/lib/profileSync';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { PaywallExitModals, type PaywallExitModal } from '@/components/PaywallExitModals';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { usePurchases } from '@/lib/usePurchases';
import { useRedirectOnceEntitled } from '@/lib/useRedirectOnceEntitled';
import { openLegalLink } from '@/lib/legalLinks';
import { trackOnboardingCompleted, trackOnboardingScreenView } from '@/lib/analytics';

type PlanId = 'monthly' | 'yearly';

export default function PaymentScreen() {
  const [plan, setPlan] = useState<PlanId>('yearly');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [modal, setModal] = useState<PaywallExitModal>('none');
  const { offering, refreshOffering, purchase, restore, entitled } = usePurchases();

  // A verdict that turns true while this screen is up (late boot / sign-in
  // answer, a subscription bought on another device) goes through
  // completeOnboarding: an entitled user leaving here has finished onboarding
  // just like a buyer (flag, profile push, onboarding_completed), and that
  // helper tracks no purchase event. See useRedirectOnceEntitled.
  const { claim } = useRedirectOnceEntitled({
    entitled,
    busy: loading || restoring,
    onEntitled: () => { void completeOnboarding(false); },
  });

  // Live, store-localized prices from the current RevenueCat offering, with the
  // designed copy as a fallback while offerings load (or in Expo Go / no key).
  // Fallbacks carry no period, matching the live priceString: the period is
  // added once where it is displayed, so the copy reads the same either way.
  const annualPrice = offering?.annual?.product.priceString ?? '$39.99';
  const monthlyPrice = offering?.monthly?.product.priceString ?? '$7.99';
  // Exit-intent discount: a dedicated, lower-priced annual package (RevenueCat
  // package id `annual_discount`, backed by the ASC product
  // `com.fitsy.mobile.yearly_discount` - 25% off, billed immediately: that
  // product has NO introductory offer, so the copy below must not promise a
  // trial). Live price with the designed copy as fallback; if the package
  // isn't configured the discount CTA says so rather than silently charging
  // full price (see handleStart).
  const discountedAnnual =
    offering?.availablePackages.find((p) => p.identifier === 'annual_discount') ?? null;
  const discountPrice = discountedAnnual?.product.priceString ?? '$29.99';

  useEffect(() => {
    trackOnboardingScreenView('payment');
  }, []);

  // The boot-time offering fetch can fail (offline at launch, StoreKit hiccup).
  // Retry when this screen opens without one so the CTA isn't dead on arrival.
  useEffect(() => {
    if (!offering) void refreshOffering();
  }, [offering, refreshOffering]);

  // Onboarding completes once the user holds Pro - whether freshly purchased or
  // restored. Shared by handleStart and handleRestore.
  async function completeOnboarding(discounted = false) {
    // Claim the one redirect before anything awaits, so the entitled hook
    // cannot fire a second replace once `loading` flips back.
    claim();
    await AsyncStorage.setItem('onboardingComplete', 'true');
    if (discounted) await AsyncStorage.setItem('discountApplied', 'true');
    pushProfileToServer();
    const d = await getOnboardingData();
    trackOnboardingCompleted({ goal: d.goal, activity_level: d.activity, has_weight: d.weightKg !== undefined, has_height: d.heightCm !== undefined });
    router.replace('/(tabs)/search');
  }

  // This screen IS the paywall - it renders Fitsy's own design and buys the
  // selected package directly through the RevenueCat SDK (no dashboard-designed
  // hosted paywall).
  async function handleStart(discounted = false) {
    // The discount CTA buys the dedicated discounted annual package; the normal
    // CTA buys the selected plan. Buying the regular annual here would charge
    // full price despite the "25% off" promise, so a missing discount package
    // is surfaced, not silently substituted.
    const pick = (off: typeof offering) =>
      discounted
        ? off?.availablePackages.find((p) => p.identifier === 'annual_discount') ?? null
        : plan === 'yearly'
          ? off?.annual
          : off?.monthly;
    // One live retry before giving up: the boot-time fetch may have failed.
    const pkg = pick(offering) ?? pick(await refreshOffering());
    if (!pkg) {
      Alert.alert(
        'Just a moment',
        discounted
          ? "This offer isn't available right now - you can still start your free trial."
          : 'Plans are still loading, please try again.',
      );
      return;
    }
    setLoading(true);
    try {
      const isPro = await purchase(pkg, discounted ? 'onboarding_discount' : 'onboarding');
      if (!isPro) return; // cancelled or errored - stay on screen
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

        {/* Subscription disclosure + legal links - required by App Store
            Guideline 3.1.2(c). Title, length, and price of the auto-renewing
            subscription, plus functional Terms of Use (EULA) and Privacy
            Policy links, must appear in the purchase flow. */}
        <Text style={s.disclosure}>
          Fitsy Pro is an auto-renewing subscription ({annualPrice}/yr or {monthlyPrice}/mo after a
          3-day free trial). Payment is charged to your Apple ID at confirmation. It renews
          automatically unless cancelled at least 24 hours before the period ends. Manage or
          cancel in your App Store account settings.
        </Text>
        <View style={s.legalRow}>
          <Pressable hitSlop={8} onPress={() => openLegalLink('terms')} accessibilityRole="link">
            <Text style={s.legalLink}>Terms of Use</Text>
          </Pressable>
          <Text style={s.legalDot}>·</Text>
          <Pressable hitSlop={8} onPress={() => openLegalLink('privacy')} accessibilityRole="link">
            <Text style={s.legalLink}>Privacy Policy</Text>
          </Pressable>
        </View>
      </WelcomeScreen>

      <PaywallExitModals
        modal={modal}
        discountPrice={discountPrice}
        onClose={() => setModal('none')}
        onClaimDiscount={() => { setModal('none'); handleStart(true); }}
        onDeclineDiscount={() => setModal('goodbye')}
        onStartTrial={() => { setModal('none'); handleStart(false); }}
        // Declining every offer still gets the locked search teaser -
        // real browsing with macro-match data blurred - rather than a
        // dead end. Same mechanic a first-time visitor gets before
        // signing up, and what resubscribe.tsx's skip does too.
        onMaybeLater={() => { setModal('none'); router.replace('/(tabs)/search?preview=1'); }}
      />
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
  disclosure: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 11,
    lineHeight: 16,
    color: EDITORIAL.textSoft,
    textAlign: 'center',
    marginTop: 12,
  },
  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 },
  legalLink: { fontFamily: FONTS.nunitoSans, fontSize: 12, fontWeight: '500', color: EDITORIAL.text, textDecorationLine: 'underline' },
  legalDot: { fontSize: 12, color: EDITORIAL.creamDeep },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planName: { fontFamily: FONTS.frauncesDisplay, fontSize: 18, color: EDITORIAL.text },
  planNameOn: { color: EDITORIAL.cream },
  planSub: { fontFamily: FONTS.nunitoSans, fontSize: 13, color: EDITORIAL.textSoft, marginTop: 2 },
  badge: { backgroundColor: 'rgba(253,251,247,0.2)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 10, fontWeight: '700', color: EDITORIAL.cream, letterSpacing: 0.5 },
  planPrice: { fontFamily: FONTS.frauncesDisplay, fontSize: 17, color: EDITORIAL.text },
  planPriceOn: { color: EDITORIAL.cream },

});
