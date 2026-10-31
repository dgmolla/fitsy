import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { openPurchasedDestination, resetWelcomeJourney } from '@/lib/paywallJourney';
import { Redirect, useNavigation } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { PurchaseIdentityRecovery } from '@/components/PurchaseIdentityRecovery';
import { HeroCard } from '@/components/DiscoveryCards';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { usePurchases } from '@/lib/usePurchases';
import { usePreviewAccess } from '@/lib/usePreviewAccess';
import { rememberPaywallDecline } from '@/lib/paywallAccess';
import { useRedirectOnceEntitled } from '@/lib/useRedirectOnceEntitled';
import { ensureSessionForPurchase } from '@/lib/purchaseSession';
import { RESUBSCRIBE_SAMPLE, RESUBSCRIBE_SAMPLE_IMAGE } from '@/lib/resubscribeSample';
import { openLegalLink } from '@/lib/legalLinks';
import { purchaseTerms } from '@/lib/purchaseTerms';
import { supabase } from '@/lib/supabase';
import { BOOT_VERDICT_CAP_MS } from '@/lib/usePurchases';
import { withinMs } from '@/lib/async';
import { clearOnboardingResume } from '@/lib/onboardingResume';
import { clearPaywallIntent } from '@/lib/paywallIntent';
import { clearPendingMealClaim } from '@/lib/pendingMealClaim';
import { clearPaymentSignInContinuation } from '@/lib/paymentSignInContinuation';
import { useOwnedHardwareBack } from '@/lib/useOwnedHardwareBack';

/**
 * Shown instead of the search tab when a signed-in user's Fitsy Pro
 * entitlement has LAPSED (RevenueCat has a past record of it, but it isn't
 * active now) - as opposed to a user who never subscribed, who sees the
 * regular inline paywall card on the search tab instead. See app/index.tsx
 * for the routing decision and lib/useEntitlementVerdict.ts for the shared
 * account-bound backend classification.
 *
 * A lapsed Fitsy account does not establish the current store account's
 * introductory eligibility. Only the live store result can promise a trial.
 */
export default function ResubscribeScreen() {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const variants = usePreviewAccess();
  const { offering, refreshOffering, purchase, restore, entitled, introEligibility, ready, isLapsed, isUnknown } = usePurchases();
  const [identity, setIdentity] = useState<'loading' | 'anonymous' | { userId: string }>('loading');
  const userId = typeof identity === 'object' ? identity.userId : null;
  const [identityUnavailable, setIdentityUnavailable] = useState(false);
  const [identityAttempt, setIdentityAttempt] = useState(0);
  useEffect(() => {
    if (!focused) { setIdentity('loading'); return; }
    let current = true;
    let authEventReceived = false;
    setIdentity('loading');
    setIdentityUnavailable(false);
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true;
      if (current) {
        setIdentity(session && !session.user.is_anonymous ? { userId: session.user.id } : 'anonymous');
        setIdentityUnavailable(false);
      }
    });
    const sessionRead = supabase.auth.getSession();
    const resolveIdentity = (session: Awaited<typeof sessionRead>['data']['session']) => {
      if (current && !authEventReceived) {
        setIdentity(session && !session.user.is_anonymous ? { userId: session.user.id } : 'anonymous');
        setIdentityUnavailable(false);
      }
    };
    void withinMs(sessionRead, BOOT_VERDICT_CAP_MS).then(result => {
      if (authEventReceived) return;
      if (result) resolveIdentity(result.data.session);
      else {
        if (current) setIdentityUnavailable(true);
        void sessionRead.then(({ data }) => resolveIdentity(data.session))
          .catch(() => { if (current) setIdentityUnavailable(true); });
      }
    }).catch(() => { if (current) setIdentityUnavailable(true); });
    return () => { current = false; listener.subscription.unsubscribe(); };
  }, [focused, identityAttempt]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // A verdict that turns true while this screen is up (late boot / sign-in
  // answer, a resubscribe made on another device) lets the user through
  // without a relaunch. See useRedirectOnceEntitled.
  const { claim } = useRedirectOnceEntitled({
    entitled: userId ? entitled : null,
    busy: loading || restoring || !focused || !ready,
    onEntitled: () => { void openPurchasedDestination(navigation, { requireTargets: true }); },
  });
  // Retry the boot-time offering fetch when arriving without one (see payment.tsx).
  useEffect(() => {
    if (!offering) void refreshOffering();
  }, [offering, refreshOffering]);

  const terms = purchaseTerms(offering?.annual?.product, introEligibility[offering?.annual?.product.identifier ?? '']);

  async function exitPlans() {
    if (loading || restoring) return;
    try {
      await Promise.all([clearPaywallIntent(), clearPendingMealClaim(),
        clearPaymentSignInContinuation(), clearOnboardingResume()]);
      if (navigation.isFocused()) resetWelcomeJourney(navigation, 'problem');
    } catch {
      Alert.alert('Could not leave plans', 'Please try again.');
    }
  }
  useOwnedHardwareBack(() => { void exitPlans(); });

  async function handleResubscribe() {
    if (!userId || !ready || !isLapsed) return;
    const annual = offering?.annual ?? (await refreshOffering())?.annual;
    if (!annual) {
      Alert.alert('Just a moment', 'Plans are still loading, please try again.');
      return;
    }
    if (!(await ensureSessionForPurchase('resubscribe'))) return;
    setLoading(true);
    try {
      const isPro = await purchase(annual, 'resubscribe');
      if (isPro) {
        claim();
        await openPurchasedDestination(navigation, { requireTargets: true });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore() {
    if (!userId || !ready || !isLapsed) return;
    if (!(await ensureSessionForPurchase('resubscribe'))) return;
    setRestoring(true);
    try {
      const outcome = await restore();
      if (outcome === 'active') {
        claim();
        await openPurchasedDestination(navigation, { requireTargets: true });
      } else if (outcome === 'expired') {
        Alert.alert('Subscription ended', 'Your previous subscription is no longer active. Choose a plan to subscribe again.');
      } else if (outcome === 'none') {
        Alert.alert('Nothing to restore', "We couldn't find an active subscription for this account.");
      }
    } finally {
      setRestoring(false);
    }
  }

  // Deep links and old navigation state must settle authentication and the
  // account verdict before a win-back purchase surface can render.
  if (identity === 'loading') return identityUnavailable
    ? <PurchaseIdentityRecovery onRetry={() => setIdentityAttempt(attempt => attempt + 1)} /> : null;
  if (userId && !ready) return null;
  if (identity === 'anonymous') return <Redirect href="/welcome/signin?returnTo=resubscribe" />;
  if (isUnknown) return <Redirect href="/welcome/subscription-check" />;
  if (entitled === true) return null;
  if (!isLapsed) return <Redirect href="/welcome/payment" />;
  return (
    <WelcomeScreen
      title={'Welcome back.'}
      subtitle="Your Fitsy Pro subscription ended. Resubscribe to keep finding restaurants that fit your macros."
      onContinue={handleResubscribe}
      canContinue={!loading && !restoring && !!terms}
      continueLabel={loading ? 'Resubscribing…' : 'Find meals that fit again'}
      onSkip={variants.access === 'preview' ? () => {
        void rememberPaywallDecline().then(() => resetWelcomeJourney(navigation, 'preview'))
          .catch(() => Alert.alert('Could not save your choice', 'Please try again.'));
      } : undefined}
      showBack
      onBack={() => { void exitPlans(); }}
    >
      <View style={s.sample}>
        <Text style={s.sampleLabel}>Sample meal</Text>
        <HeroCard result={RESUBSCRIBE_SAMPLE} locked={false} paywallPreview hideDistance imageSource={RESUBSCRIBE_SAMPLE_IMAGE} />
      </View>

      <Pressable
        style={s.restore}
        onPress={handleRestore}
        disabled={restoring}
        accessibilityRole="button"
        testID="resubscribe-restore"
      >
        <Text style={s.restoreTxt}>{restoring ? 'Restoring…' : 'Restore purchases'}</Text>
      </Pressable>

      <Text style={s.disclosure}>
        {terms?.disclosure ?? 'Fetching current prices and subscription terms from the store…'}
      </Text>
      {!terms && (
        <Pressable style={s.restore} onPress={() => { void refreshOffering(); }} accessibilityRole="button" testID="resubscribe-retry-pricing">
          <Text style={s.restoreTxt}>Retry loading plans</Text>
        </Pressable>
      )}
      <View style={s.legalRow}>
        <Pressable hitSlop={8} onPress={() => openLegalLink('terms')} accessibilityRole="link" testID="resubscribe-terms-link">
          <Text style={s.legalLink}>Terms of Use</Text>
        </Pressable>
        <Text style={s.legalDot}>·</Text>
        <Pressable hitSlop={8} onPress={() => openLegalLink('privacy')} accessibilityRole="link" testID="resubscribe-privacy-link">
          <Text style={s.legalLink}>Privacy Policy</Text>
        </Pressable>
      </View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  sample: { marginBottom: 20, gap: 8 },
  sampleLabel: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 12, color: EDITORIAL.textSoft },
  restore: { alignItems: 'center', paddingVertical: 10, marginBottom: 8 },
  restoreTxt: { fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.textSoft },
  disclosure: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 11,
    lineHeight: 16,
    color: EDITORIAL.textSoft,
    textAlign: 'center',
    marginBottom: 10,
  },
  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  legalLink: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 12, fontWeight: '600', color: EDITORIAL.textMid },
  legalDot: { color: EDITORIAL.textSoft, fontSize: 12 },
});
