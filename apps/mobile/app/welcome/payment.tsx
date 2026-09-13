import React, { useEffect, useRef, useState } from 'react';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { useIsFocused } from '@react-navigation/native';
import { Alert } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { PaywallView } from '@/components/PaywallView';
import { PaywallExitModals, type PaywallExitModal } from '@/components/PaywallExitModals';
import { recordOnboardingComplete } from '@/lib/onboardingCompletion';
import { usePurchases } from '@/lib/usePurchases';
import { useRedirectOnceEntitled } from '@/lib/useRedirectOnceEntitled';
import { ensureSessionForPurchase } from '@/lib/purchaseSession';
import { trackOnboardingScreenView, trackPaywallExperimentExposure } from '@/lib/analytics';
import { usePreviewAccess } from '@/lib/usePreviewAccess';
import { rememberPaywallDecline } from '@/lib/paywallAccess';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { fetchGuidedPreview } from '@/lib/guidedPreview';
import { openPurchasedDestination, resetWelcomeJourney } from '@/lib/paywallJourney';
import { getPaywallIntent, type PaywallIntent } from '@/lib/paywallIntent';
import { purchaseTerms, savingPercent } from '@/lib/purchaseTerms';

type PlanId = 'monthly' | 'yearly';

export default function PaymentScreen() {
  useOnboardingStep('payment');
  const navigation = useNavigation();
  const focused = useIsFocused();
  const [intent, setIntent] = useState<PaywallIntent | null>(null);
  const [plan, setPlan] = useState<PlanId>('yearly');
  const variants = usePreviewAccess();
  const exposure = useRef('');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [modal, setModal] = useState<PaywallExitModal>('none');
  const { offering, introEligibility, refreshOffering, purchase, restore, entitled } = usePurchases();
  const purchaseBusy = useRef(false);

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

  const annualTerms = purchaseTerms(offering?.annual?.product, offering?.annual ? introEligibility[offering.annual.product.identifier] : false);
  const monthlyTerms = purchaseTerms(offering?.monthly?.product, offering?.monthly ? introEligibility[offering.monthly.product.identifier] : false);
  const discountedAnnual =
    offering?.availablePackages.find((p) => p.identifier === 'annual_discount') ?? null;
  const selected = plan === 'yearly' ? offering?.annual : offering?.monthly;
  const terms = purchaseTerms(selected?.product, selected ? introEligibility[selected.product.identifier] : false);
  const discountTerms = purchaseTerms(discountedAnnual?.product, discountedAnnual ? introEligibility[discountedAnnual.product.identifier] : false);
  const discountPercent = savingPercent(offering?.annual?.product, discountedAnnual?.product);

  useEffect(() => {
    trackOnboardingScreenView('payment');
    let live = true;
    void Promise.all([getPaywallIntent(), getOnboardingData()]).then(async ([saved, data]) => {
      if (!live || !saved) return;
      setIntent({ ...saved, nearbyDishCount: undefined });
      if (data.area && data.area.name === saved.areaName) {
        try {
          const preview = await fetchGuidedPreview(data.area);
          if (live) setIntent({ ...saved, nearbyDishCount: preview.meta.nearbyDishCount });
        } catch { /* Count is optional; never substitute a fabricated total. */ }
      }
    });
    return () => { live = false; };
  }, []);

  // The boot-time offering fetch can fail (offline at launch, StoreKit hiccup).
  // Retry when this screen opens without one so the CTA isn't dead on arrival.
  useEffect(() => {
    if (!offering) void refreshOffering();
  }, [offering, refreshOffering]);

  useEffect(() => {
    if (!offering) return;
    const key = `${offering.identifier}:${variants.access}:${variants.image}`;
    if (exposure.current === key) return;
    exposure.current = key;
    trackPaywallExperimentExposure({ offering_id: offering.identifier, access_variant: variants.access, image_variant: variants.image });
  }, [offering, variants.access, variants.image]);

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
    const firstCompletion = await recordOnboardingComplete(discounted);
    if (firstCompletion) resetWelcomeJourney(navigation, 'notification-permission');
    else await openPurchasedDestination(navigation);
  }

  // This screen IS the paywall - it renders Fitsy's own design and buys the
  // selected package directly through the RevenueCat SDK (no dashboard-designed
  // hosted paywall).
  async function handleStart(discounted = false) {
    if (purchaseBusy.current || restoring) return;
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
      const isPro = await purchase(pkg, discounted ? 'onboarding_discount' : 'onboarding');
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
    if (purchaseBusy.current || restoring) return;
    purchaseBusy.current = true;
    setRestoring(true);
    try {
      if (!(await ensureSessionForPurchase())) return;
      const isPro = await restore();
      if (isPro) {
        await completeOnboarding();
      } else {
        Alert.alert('Nothing to restore', "We couldn't find an active subscription for this account.");
      }
    } finally {
      purchaseBusy.current = false;
      setRestoring(false);
    }
  }

  return (
    <>
      <PaywallView
        plan={plan}
        annual={annualTerms}
        monthly={monthlyTerms}
        showImage={variants.image === 'meal'}
        loading={loading}
        restoring={restoring}
        onSelect={setPlan}
        onBack={navigation.canGoBack() ? () => router.back() : undefined}
        context={intent?.mealName ? `${intent.action === 'save' ? 'Save' : 'See the full menu for'} ${intent.mealName}. Plus craving search and meals that fit.` : undefined}
        localProof={intent?.nearbyDishCount ? `${intent.nearbyDishCount.toLocaleString()} dishes with nutrition within 3 miles of ${intent.areaName ?? 'your selected area'}.` : undefined}
        onRestore={() => { void handleRestore(); }}
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
