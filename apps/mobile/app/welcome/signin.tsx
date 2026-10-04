import { clearOnboardingResume, useOnboardingStep } from '@/lib/onboardingResume';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect, useNavigation } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

import { appleSignIn, completeGoogleSignIn, devLogin } from '@/lib/authClient';
import { pullProfileFromServer } from '@/lib/profileSync';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { OnboardingAccountSummary } from '@/components/OnboardingAccountSummary';
import { WelcomeAuthActions } from '@/components/WelcomeAuthActions';
import { claimPaywallIntent, clearPaywallIntent, getPaywallIntent, markPurchasedContinuation, type PaywallIntent } from '@/lib/paywallIntent';
import { getMacroTargets, type StoredMacroTargets } from '@/lib/macroStorage';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { identifyUser, trackAuthFailure, trackAuthSuccess, trackOnboardingScreenView } from '@/lib/analytics';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { useRouteContinuation } from '@/lib/useRouteContinuation';
import { bindPaymentSignInContinuation, clearPaymentSignInContinuation, hasPaymentSignInContinuation, preparePaymentSignInContinuation } from '@/lib/paymentSignInContinuation';
import { clearPendingMealClaim } from '@/lib/pendingMealClaim';
import { syncPaywallVerdictForCheckout } from '@/lib/teaserGate';
import { openPurchasedDestination } from '@/lib/paywallJourney';
import { withinMs } from '@/lib/async';
import { BOOT_VERDICT_CAP_MS } from '@/lib/usePurchases';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

async function checkoutVerdict() {
  try { return await withinMs(syncPaywallVerdictForCheckout(), BOOT_VERDICT_CAP_MS) ?? 'unknown'; }
  catch { return 'unknown'; }
}

async function captureIdentity(userId: string, email?: string | null): Promise<void> {
  const [mt, od] = await Promise.all([getMacroTargets(), getOnboardingData()]);
  identifyUser(userId, {
    email: email ?? undefined,
    goal: od.goal,
    activity_level: od.activity,
    macro_protein: mt?.protein != null ? Number(mt.protein) : undefined,
    macro_carbs: mt?.carbs != null ? Number(mt.carbs) : undefined,
    macro_fat: mt?.fat != null ? Number(mt.fat) : undefined,
    macro_calories: mt?.calories != null ? Number(mt.calories) : undefined,
  });
}

export default function SignInScreen() {
  const navigation = useNavigation();
  const { begin, cancel } = useRouteContinuation();
  const googleContinuation = useRef<() => boolean>(() => false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [devLoading, setDevLoading] = useState(false);
  const [selection, setSelection] = useState<{ intent: PaywallIntent | null; targets: StoredMacroTargets | null }>({ intent: null, targets: null });
  useFocusEffect(useCallback(() => {
    let live = true;
    setAppleLoading(false); setGoogleLoading(false); setDevLoading(false);
    void Promise.all([getPaywallIntent(), getMacroTargets()]).then(([intent, targets]) => { if (live) setSelection({ intent, targets }); });
    return () => { live = false; };
  }, []));

  // New accounts see live trial terms and optional reminders before plans.
  // Skip onboarding review; existing in-app prompts use lib/ratingPrompt.ts.
  const { outOfArea, returnTo } = useLocalSearchParams<{ outOfArea?: string; returnTo?: string }>();
  useEffect(() => {
    if (returnTo === 'payment') void preparePaymentSignInContinuation();
  }, [returnTo]);
  useEffect(() => {
    if (outOfArea === '1') void Promise.allSettled([
      clearPaymentSignInContinuation(), clearPendingMealClaim(), clearPaywallIntent(),
    ]);
  }, [outOfArea]);
  // A cold launch cannot recover this screen's query parameters. Keep the
  // waitlist checkpoint so interrupted signup never resumes toward a paywall.
  useOnboardingStep(outOfArea === '1' ? 'out-of-area' : 'signin');

  const navigateAfterAuth = useCallback(async (isNewUser: boolean, userId: string, ownedCheckout: boolean | null, isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    if (outOfArea === '1') {
      await clearPaymentSignInContinuation();
      await clearPendingMealClaim();
      if (isCurrent()) router.dismissTo('/welcome/out-of-area');
      return;
    }
    if (ownedCheckout !== null) {
      const verdict = await checkoutVerdict();
      if (!isCurrent()) return;
      if (verdict === 'active') {
        // Keep the selected meal durable before consuming the sign-in marker.
        // A process exit here must still reopen the owned meal on next launch.
        await markPurchasedContinuation();
        if (!isCurrent()) return;
        await clearPendingMealClaim();
        if (!isCurrent()) return;
        await clearPaymentSignInContinuation();
        if (!isCurrent()) return;
        await openPurchasedDestination(navigation, { requireTargets: true, isCurrent });
      } else if (verdict === 'expired') {
        await clearPendingMealClaim();
        if (!isCurrent()) return;
        await clearPaymentSignInContinuation();
        if (isCurrent()) router.dismissTo('/welcome/resubscribe');
      } else {
        await clearPendingMealClaim();
        if (!isCurrent()) return;
        router.replace(verdict === 'never_subscribed'
          ? ownedCheckout ? '/welcome/payment' : '/welcome/trial'
          : '/welcome/subscription-check');
      }
      return;
    }
    if (returnTo === 'resubscribe') {
      const verdict = await checkoutVerdict();
      if (!isCurrent()) return;
      await clearPaymentSignInContinuation();
      if (!isCurrent()) return;
      if (verdict === 'active') {
        await openPurchasedDestination(navigation, { requireTargets: true, isCurrent });
      } else if (verdict === 'expired') {
        router.replace('/welcome/resubscribe');
      } else if (verdict === 'never_subscribed') {
        router.replace('/welcome/payment');
      } else {
        router.dismissTo('/welcome/subscription-check');
      }
      return;
    }
    if (returnTo === 'trial-reminder') {
      await clearPaymentSignInContinuation();
      await clearPendingMealClaim();
      if (isCurrent()) router.dismissTo(`/welcome/${returnTo}`);
      return;
    }
    const intent = await getPaywallIntent();
    if (!isCurrent()) return;
    if (intent) {
      const verdict = await checkoutVerdict();
      if (!isCurrent()) return;
      if (verdict === 'active') {
        await openPurchasedDestination(navigation, { requireTargets: true, isCurrent });
        return;
      }
      if (verdict === 'expired') {
        router.replace('/welcome/resubscribe');
        return;
      }
      if (verdict === 'unknown') {
        router.replace('/welcome/subscription-check');
        return;
      }
    }
    const destination = isNewUser || intent ? '/welcome/trial' : '/(tabs)/search';
    if (isCurrent()) router.replace(destination);
    await clearPendingMealClaim();
  }, [navigation, outOfArea, returnTo]);

  const finishAuth = useCallback(async (r: Awaited<ReturnType<typeof appleSignIn>>, provider: 'apple' | 'google' | 'dev', isCurrent: () => boolean) => {
    trackAuthSuccess({ provider, is_new_user: provider === 'dev' ? false : r.isNewUser });
    // The SDK retains the completed session even if this route was left.
    // A stale continuation must not claim a newer preview's selected meal.
    if (!isCurrent()) return;
    const checkoutRequested = returnTo === 'payment' || (!returnTo && await hasPaymentSignInContinuation());
    if (!isCurrent()) return;
    let ownedCheckout: boolean | null = null;
    if (checkoutRequested) {
      if (returnTo === 'payment') await preparePaymentSignInContinuation();
      if (!isCurrent()) return;
      ownedCheckout = await bindPaymentSignInContinuation(r.user.id);
      if (!isCurrent()) return;
      if (ownedCheckout) await claimPaywallIntent(r.user.id);
      else await Promise.all([clearPaywallIntent(), clearPendingMealClaim()]);
    } else await claimPaywallIntent(r.user.id);
    if (!isCurrent()) return;
    await captureIdentity(r.user.id, r.user.email);
    if (!isCurrent()) return;
    if (!r.isNewUser && outOfArea !== '1' && !(await getPaywallIntent()) && isCurrent()) await pullProfileFromServer();
    await navigateAfterAuth(r.isNewUser, r.user.id, ownedCheckout, isCurrent);
  }, [navigateAfterAuth, outOfArea, returnTo]);

  const [, response, promptGoogleAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID ?? 'not-configured',
    clientId: GOOGLE_WEB_CLIENT_ID,
  });

  useEffect(() => {
    trackOnboardingScreenView('signin');
  }, []);

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params['id_token'];
      if (idToken) {
        const isCurrent = googleContinuation.current;
        if (isCurrent()) setGoogleLoading(true);
        completeGoogleSignIn(idToken)
          .then(r => finishAuth(r, 'google', isCurrent))
          .catch((err: Error) => {
            trackAuthFailure({ provider: 'google', error_message: err.message });
            if (isCurrent()) Alert.alert('Sign In Failed', err.message);
          })
          .finally(() => { if (isCurrent()) setGoogleLoading(false); });
      }
    } else if (response?.type === 'error') {
      trackAuthFailure({ provider: 'google', error_message: response.error?.message });
      if (googleContinuation.current()) Alert.alert('Google Sign In Error', response.error?.message ?? 'Unknown error');
    }
  }, [response, finishAuth]);

  async function handleApple() {
    const isCurrent = begin();
    setAppleLoading(true);
    try {
      const r = await appleSignIn();
      await finishAuth(r, 'apple', isCurrent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apple Sign In failed';
      if (!msg.includes('canceled')) {
        trackAuthFailure({ provider: 'apple', error_message: msg });
        if (isCurrent()) Alert.alert('Sign In Failed', msg);
      }
    } finally { if (isCurrent()) setAppleLoading(false); }
  }

  async function handleGoogle() {
    if (!GOOGLE_IOS_CLIENT_ID) { Alert.alert('Not Configured', 'Google Sign In is not configured yet.'); return; }
    const isCurrent = begin();
    googleContinuation.current = isCurrent;
    setGoogleLoading(true);
    try {
      const result = await promptGoogleAsync();
      if (result.type !== 'success' && isCurrent()) setGoogleLoading(false);
    } catch (err) {
      if (isCurrent()) { setGoogleLoading(false); Alert.alert('Google Sign In Error', err instanceof Error ? err.message : 'Please try again.'); }
    }
  }

  // Dev-only: skip Apple/Google (which need real OAuth config / a signed build)
  // and authenticate with a throwaway account so onboarding can be exercised on
  // the simulator. Continues the normal post-signin onboarding chain.
  async function handleDevLogin() {
    const isCurrent = begin();
    setDevLoading(true);
    try {
      const r = await devLogin();
      // Continue where a new user would land, so the full flow is testable on the sim.
      await finishAuth({ ...r, isNewUser: true }, 'dev', isCurrent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Dev login failed';
      trackAuthFailure({ provider: 'dev', error_message: msg });
      if (isCurrent()) Alert.alert('Dev Login Failed', msg);
    } finally {
      if (isCurrent()) setDevLoading(false);
    }
  }

  const busy = appleLoading || googleLoading || devLoading;

  const hasIntent = outOfArea !== '1' && !!selection.intent;
  return <WelcomeScreen progress={0.82}
    title={hasIntent ? "Keep this\nrestaurant in reach." : 'Create an account'}
    subtitle={hasIntent ? 'Keep your pick, then choose a plan to open its full menu.' : outOfArea === '1' ? 'Sign in for updates when more menus arrive in your area.' : 'Keep your meal picks and targets with one sign-in.'}
    onContinue={() => {}} canContinue={false} hideFooter
    onBack={() => {
      cancel();
      void (async () => {
        // A cold resume loses query parameters, so read the durable checkout
        // marker before clearing it. Never Back into a retained paywall.
        const paymentReturn = returnTo === 'payment' || returnTo === 'resubscribe' ||
          await hasPaymentSignInContinuation().catch(() => true);
        await Promise.allSettled([clearPaywallIntent(), clearPaymentSignInContinuation(), clearPendingMealClaim(), clearOnboardingResume()]);
        if (!navigation.isFocused()) return;
        if (paymentReturn || !navigation.canGoBack()) router.replace('/welcome/problem');
        else if (navigation.canGoBack()) router.back();
      })();
    }}
    footerContent={<>
      <WelcomeAuthActions busy={busy} appleLoading={appleLoading} googleLoading={googleLoading} devLoading={devLoading}
        onApple={handleApple} onGoogle={handleGoogle} onDev={handleDevLogin} />
      <Text style={s.legal}>By continuing you agree to our Terms of Service and Privacy Policy.</Text>
    </>}>
    {hasIntent && selection.intent && <OnboardingAccountSummary intent={selection.intent} targets={selection.targets} />}
  </WelcomeScreen>;
}

const s = StyleSheet.create({
  legal: { fontFamily: FONTS.nunitoSans, fontSize: 12, textAlign: 'center', lineHeight: 18, color: EDITORIAL.textSoft },
});
