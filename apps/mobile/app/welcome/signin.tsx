import { useOnboardingStep } from '@/lib/onboardingResume';
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
import { claimPaywallIntent, clearPaywallIntent, getPaywallIntent, type PaywallIntent } from '@/lib/paywallIntent';
import { getMacroTargets, type StoredMacroTargets } from '@/lib/macroStorage';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { identifyUser, trackAuthFailure, trackAuthSuccess, trackOnboardingScreenView } from '@/lib/analytics';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { useRouteContinuation } from '@/lib/useRouteContinuation';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

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

  // Continue from the preview to live plan terms. Permissions follow purchase.
  // Skip onboarding review; existing in-app prompts use lib/ratingPrompt.ts.
  const { outOfArea, returnTo } = useLocalSearchParams<{ outOfArea?: string; returnTo?: string }>();
  // A cold launch cannot recover this screen's query parameters. Keep the
  // waitlist checkpoint so interrupted signup never resumes toward a paywall.
  useOnboardingStep(outOfArea === '1' ? 'out-of-area' : 'signin');

  const navigateAfterAuth = useCallback(async (isNewUser: boolean, isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    if (outOfArea === '1') {
      router.dismissTo('/welcome/out-of-area');
      return;
    }
    if (returnTo === 'payment' || returnTo === 'resubscribe') {
      router.dismissTo(`/welcome/${returnTo}`);
      return;
    }
    const destination = isNewUser || await getPaywallIntent() ? '/welcome/payment' : '/(tabs)/search';
    if (isCurrent()) router.replace(destination);
  }, [outOfArea, returnTo]);

  const finishAuth = useCallback(async (r: Awaited<ReturnType<typeof appleSignIn>>, provider: 'apple' | 'google' | 'dev', isCurrent: () => boolean) => {
    trackAuthSuccess({ provider, is_new_user: provider === 'dev' ? false : r.isNewUser });
    // The SDK retains the completed session even if this route was left.
    // A stale continuation must not claim a newer preview's selected meal.
    if (!isCurrent()) return;
    await claimPaywallIntent(r.user.id);
    await captureIdentity(r.user.id, r.user.email);
    if (!isCurrent()) return;
    if (!r.isNewUser && outOfArea !== '1' && !(await getPaywallIntent()) && isCurrent()) await pullProfileFromServer();
    await navigateAfterAuth(r.isNewUser, isCurrent);
  }, [navigateAfterAuth, outOfArea]);

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
    onBack={navigation.canGoBack() ? () => {
      cancel();
      const goBack = () => { if (navigation.isFocused() && navigation.canGoBack()) router.back(); };
      void clearPaywallIntent().then(goBack, goBack);
    } : undefined}
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
