import React, { useEffect, useRef, useState } from 'react';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { useIsFocused } from '@react-navigation/native';
import { Alert } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { PaywallView } from '@/components/PaywallView';
import { PaywallExitModals, type PaywallExitModal } from '@/components/PaywallExitModals';
import { recordOnboardingComplete } from '@/lib/onboardingCompletion';
import { usePurchases } from '@/lib/usePurchases';
import { useRedirectOnceEntitled } from '@/lib/useRedirectOnceEntitled';
import { ensureSessionForPurchase } from '@/lib/purchaseSession';
import { trackOnboardingScreenView, trackPaywallExperimentExposure, trackPaywallShown } from '@/lib/analytics';
import { usePreviewAccess } from '@/lib/usePreviewAccess';
import { rememberPaywallDecline } from '@/lib/paywallAccess';
import { openPurchasedDestination, resetWelcomeJourney } from '@/lib/paywallJourney';
import { annualSavingPercent, purchaseTerms, savingPercent } from '@/lib/purchaseTerms';
import { devTrialVisualOffer } from '@/lib/devTrialVisualOffer';
import { clearOnboardingPreviewEntry } from '@/lib/onboardingPreviewEntry';
import { usePaywallDiscovery } from '@/lib/usePaywallDiscovery';
import { paywallVariantConfig, resolvePaywallVariant, type PaywallVariant } from '@/lib/paywallVariant';
import { supabase } from '@/lib/supabase';

type PlanId = 'monthly' | 'yearly';

export default function PaymentScreen() {
  const { devTrialVisual, devPaywallVariant } = useLocalSearchParams<{ devTrialVisual?: string; devPaywallVariant?: string }>();
  const visualRequested = __DEV__ && devTrialVisual === '1';
  useOnboardingStep('payment');
  const navigation = useNavigation();
  const focused = useIsFocused();
  const discovery = usePaywallDiscovery(focused);
  useEffect(() => {
    if (focused) void clearOnboardingPreviewEntry();
  }, [focused]);
  const [chosenPlan, setChosenPlan] = useState<PlanId | null>(null);
  const variants = usePreviewAccess();
  const exposure = useRef('');
  const [userId, setUserId] = useState<string | null>(null);
  const [identityReady, setIdentityReady] = useState(false);
  const testerOverride: PaywallVariant | undefined = __DEV__ && (devPaywallVariant === 'A' || devPaywallVariant === 'B') ? devPaywallVariant : undefined;
  useEffect(() => {
    if (!focused) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => { if (active) setUserId(data.session?.user.id ?? null); })
      .catch(() => { if (active) setUserId(null); })
      .finally(() => { if (active) setIdentityReady(true); });
    return () => { active = false; };
  }, [focused]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [modal, setModal] = useState<PaywallExitModal>('none');
  const { offering, introEligibility, introEligibilityReady, refreshOffering, purchase, restore, showManageSubscriptions, entitled } = usePurchases();
  const variantConfig = paywallVariantConfig(offering?.metadata);
  const paywallVariant = resolvePaywallVariant(variantConfig, userId, testerOverride);
  const visual = devTrialVisualOffer(offering, visualRequested);
  const shownOffering = visual?.offering ?? offering;
  const shownEligibility = visual?.eligibility ?? introEligibility;
  const eligibilityReady = !!visual || introEligibilityReady;
  const purchaseBusy = useRef(false);
  const settledDefaultPlan = useRef<PlanId | null>(null);

  // A verdict that turns true while this screen is up (late boot / sign-in
  // answer, a subscription bought on another device) goes through
  // completeOnboarding: an entitled user leaving here has finished onboarding
  // just like a buyer (flag, profile push, onboarding_completed), and that
  // helper tracks no purchase event. See useRedirectOnceEntitled.
  const { claim } = useRedirectOnceEntitled({
    entitled,
    busy: loading || restoring || !focused,
    onEntitled: () => { void completeOnboarding(false); },
  });

  const annualTerms = purchaseTerms(shownOffering?.annual?.product, shownOffering?.annual ? shownEligibility[shownOffering.annual.product.identifier] : false);
  const monthlyTerms = purchaseTerms(shownOffering?.monthly?.product, shownOffering?.monthly ? shownEligibility[shownOffering.monthly.product.identifier] : false);
  // Follow the trial promised earlier in onboarding unless the user has
  // explicitly chosen another available plan. Recompute when store terms or
  // eligibility change while the paywall is open.
  const defaultPlan: PlanId = monthlyTerms?.trial && !annualTerms?.trial ? 'monthly' : annualTerms ? 'yearly' : monthlyTerms ? 'monthly' : 'yearly';
  const checkingPlans = !!shownOffering && !eligibilityReady;
  if (!checkingPlans) settledDefaultPlan.current = defaultPlan;
  const heldPlan = settledDefaultPlan.current;
  const automaticPlan = checkingPlans && heldPlan && (heldPlan === 'yearly' ? annualTerms : monthlyTerms) ? heldPlan : defaultPlan;
  const plan = chosenPlan && (chosenPlan === 'yearly' ? annualTerms : monthlyTerms) ? chosenPlan : automaticPlan;
  const discountedAnnual =
    offering?.availablePackages.find((p) => p.identifier === 'annual_discount') ?? null;
  const selected = plan === 'yearly' ? offering?.annual : offering?.monthly;
  const terms = purchaseTerms(selected?.product, selected ? introEligibility[selected.product.identifier] : false);
  const discountTerms = purchaseTerms(discountedAnnual?.product, discountedAnnual ? introEligibility[discountedAnnual.product.identifier] : false);
  const discountPercent = savingPercent(offering?.annual?.product, discountedAnnual?.product);
  const annualPercent = annualSavingPercent(shownOffering?.annual?.product, shownOffering?.monthly?.product);

  useEffect(() => {
    if (!visualRequested) trackOnboardingScreenView('payment');

  }, [visualRequested]);

  // The boot-time offering fetch can fail (offline at launch, StoreKit hiccup).
  // Retry when this screen opens without one so the CTA isn't dead on arrival.
  useEffect(() => {
    if (!offering) void refreshOffering();
  }, [offering, refreshOffering]);

  useEffect(() => {
    if (!offering || visualRequested || !userId || !focused || !identityReady) return;
    const key = `${userId}:${offering.identifier}:${variants.access}:${paywallVariant}:${variantConfig.version}`;
    if (exposure.current === key) return;
    exposure.current = key;
    const attribution = { paywall_variant: paywallVariant, paywall_config_version: variantConfig.version };
    trackPaywallShown({ source: 'onboarding', ...attribution });
    trackPaywallExperimentExposure({ offering_id: offering.identifier, access_variant: variants.access, image_variant: 'meal', layout_variant: paywallVariant === 'A' ? 'mosaic_benefits' : 'trial_timeline', ...attribution });
  }, [offering, variants.access, visualRequested, userId, focused, identityReady, paywallVariant, variantConfig.version]);

  async function declineSubscription() {
    try {
      await rememberPaywallDecline();
      setModal('none');
      resetWelcomeJourney(navigation, variants.access === 'preview' ? 'preview' : 'payment');
    } catch { Alert.alert('Could not save your choice', 'Please try again.'); }
  }

  // Onboarding completes once the user holds Pro - whether freshly purchased or
  // restored. Shared by handleStart and handleRestore.
  async function completeOnboarding(discounted = false) {
    // Claim the one redirect before anything awaits, so the entitled hook
    // cannot fire a second replace once `loading` flips back. The recording
    // itself is idempotent (a re-entered paywall must not double-count).
    claim();
    await recordOnboardingComplete(discounted);
    await openPurchasedDestination(navigation);
  }

  // This screen IS the paywall - it renders Fitsy's own design and buys the
  // selected package directly through the RevenueCat SDK (no dashboard-designed
  // hosted paywall).
  async function handleStart(discounted = false) {
    if (visualRequested) {
      Alert.alert('Visual preview only', 'This synthetic trial cannot be purchased. Open the regular paywall for live Test Store plans.');
      return;
    }
    if (purchaseBusy.current || restoring || checkingPlans) return;
    purchaseBusy.current = true;
    setLoading(true);
    try {
      const pick = (off: typeof offering) =>
        discounted
          ? off?.availablePackages.find((p) => p.identifier === 'annual_discount') ?? null
          : plan === 'yearly'
            ? off?.annual
            : off?.monthly;
      // One live retry before giving up: the boot-time fetch may have failed.
      const pkg = pick(offering) ?? pick(await refreshOffering());
      if (!pkg || !purchaseTerms(pkg.product)) {
        Alert.alert(
          'Just a moment',
          discounted
            ? 'This offer is unavailable. You can choose one of the plans shown here.'
            : 'Plans are still loading, please try again.',
        );
        return;
      }
      if (!(await ensureSessionForPurchase())) return;
      const isPro = await purchase(pkg, discounted ? 'onboarding_discount' : 'onboarding', { paywall_variant: paywallVariant, paywall_config_version: variantConfig.version });
      if (!isPro) return; // cancelled or errored - stay on screen
      await completeOnboarding(discounted);
    } finally {
      purchaseBusy.current = false;
      setLoading(false);
    }
  }

  // Apple requires a Restore Purchases path. It lives here (the paywall) rather
  // than in-app, since a reinstalled subscriber re-runs onboarding.
  async function handleRestore() {
    if (visualRequested) {
      Alert.alert('Visual preview only', 'Restore is unavailable in the synthetic trial preview.');
      return;
    }
    if (purchaseBusy.current || restoring) return;
    purchaseBusy.current = true;
    setRestoring(true);
    try {
      if (!(await ensureSessionForPurchase())) return;
      const isPro = await restore();
      if (isPro) {
        await completeOnboarding();
      } else if (isPro === false) {
        Alert.alert('Nothing to restore', "We couldn't find an active subscription for this account.");
      }
    } finally {
      purchaseBusy.current = false;
      setRestoring(false);
    }
  }

  if (!identityReady) return null;
  return (
    <>
      <PaywallView
        plan={plan}
        annual={annualTerms}
        monthly={monthlyTerms}
        annualSavingPercent={annualPercent}
        discovery={discovery}
        variant={paywallVariant}
        loading={loading}
        restoring={restoring}
        checkingPlans={checkingPlans}
        visualPreview={!!visual}
        onSelect={setChosenPlan}
        onBack={() => { if (navigation.canGoBack()) router.back(); else router.replace('/welcome/trial-reminder'); }}
        onRestore={() => { void handleRestore(); }}
        onManage={() => { void showManageSubscriptions(); }}
        onRetry={() => { void refreshOffering(); }}
        onPurchase={() => { void handleStart(false); }}
        onDecline={() => { if (!loading && !restoring) setModal(discountTerms && discountPercent ? 'discount' : 'goodbye'); }}
      />

      <PaywallExitModals
        modal={modal}
        discountPercent={discountPercent}
        discountDisclosure={discountTerms?.disclosure ?? ''}
        trialAvailable={!!terms?.trial}
        onClose={() => setModal('none')}
        onClaimDiscount={() => { setModal('none'); handleStart(true); }}
        onDeclineDiscount={() => setModal('goodbye')}
        onStartTrial={() => { setModal('none'); handleStart(false); }}
        declineLabel={variants.access === 'hard' ? 'Close' : 'Browse the preview'}
        onMaybeLater={() => { void declineSubscription(); }}
      />
    </>
  );
}
