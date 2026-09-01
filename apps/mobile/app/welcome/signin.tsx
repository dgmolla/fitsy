import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

import { Ionicons } from '@expo/vector-icons';
import { appleSignIn, completeGoogleSignIn, devLogin } from '@/lib/authClient';
import { pullProfileFromServer } from '@/lib/profileSync';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { getMacroTargets } from '@/lib/macroStorage';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { identifyUser, trackAuthFailure, trackAuthSuccess, trackOnboardingScreenView } from '@/lib/analytics';
import { EDITORIAL, FONTS } from '@/lib/brand';

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
  const [appleLoading, setAppleLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [devLoading, setDevLoading] = useState(false);

  // Sign-in now happens AFTER the anonymous onboarding narrative + the locked
  // search-screen teaser (`/(tabs)/search?preview=1` - see welcome/finding.tsx),
  // so a new user continues into a forced review ask (welcome/leave-review)
  // right after account creation, then into location/notification setup.
  // `outOfArea` is legacy plumbing from the old dedicated teaser screen; the
  // search screen's own empty state now covers "no matches nearby" instead.
  const { outOfArea } = useLocalSearchParams<{ outOfArea?: string }>();
  const newUserDestination = outOfArea === '1' ? '/welcome/leave-review?outOfArea=1' : '/welcome/leave-review';

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
        setGoogleLoading(true);
        completeGoogleSignIn(idToken)
          .then(async (r) => {
            trackAuthSuccess({ provider: 'google', is_new_user: r.isNewUser });
            await captureIdentity(r.user.id, r.user.email);
            if (!r.isNewUser) await pullProfileFromServer();
            setGoogleLoading(false);
            // A NEW user just finished the anonymous narrative + teaser, so they
            // continue into location/notification setup; a RETURNING user already
            // has a profile and skips straight to the app.
            router.replace(r.isNewUser ? newUserDestination : '/(tabs)/search');
          })
          .catch((err: Error) => {
            trackAuthFailure({ provider: 'google', error_message: err.message });
            setGoogleLoading(false);
            Alert.alert('Sign In Failed', err.message);
          });
      }
    } else if (response?.type === 'error') {
      trackAuthFailure({ provider: 'google', error_message: response.error?.message });
      Alert.alert('Google Sign In Error', response.error?.message ?? 'Unknown error');
    }
  }, [response]);

  async function handleApple() {
    setAppleLoading(true);
    try {
      const r = await appleSignIn();
      trackAuthSuccess({ provider: 'apple', is_new_user: r.isNewUser });
      await captureIdentity(r.user.id, r.user.email);
      if (!r.isNewUser) await pullProfileFromServer();
      // New user → continue into location/notification setup; returning user → straight to the app.
      router.replace(r.isNewUser ? newUserDestination : '/(tabs)/search');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apple Sign In failed';
      if (!msg.includes('canceled')) {
        trackAuthFailure({ provider: 'apple', error_message: msg });
        Alert.alert('Sign In Failed', msg);
      }
    } finally { setAppleLoading(false); }
  }

  async function handleGoogle() {
    if (!GOOGLE_IOS_CLIENT_ID) { Alert.alert('Not Configured', 'Google Sign In is not configured yet.'); return; }
    await promptGoogleAsync();
  }

  // Dev-only: skip Apple/Google (which need real OAuth config / a signed build)
  // and authenticate with a throwaway account so onboarding can be exercised on
  // the simulator. Continues the normal post-signin onboarding chain.
  async function handleDevLogin() {
    setDevLoading(true);
    try {
      const r = await devLogin();
      trackAuthSuccess({ provider: 'dev', is_new_user: false });
      await captureIdentity(r.user.id, r.user.email);
      // Continue where a new user would land, so the full flow is testable on the sim.
      router.replace(newUserDestination);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Dev login failed';
      trackAuthFailure({ provider: 'dev', error_message: msg });
      Alert.alert('Dev Login Failed', msg);
    } finally {
      setDevLoading(false);
    }
  }

  const busy = appleLoading || googleLoading || devLoading;

  return (
    <WelcomeScreen
      title="Create an account"
      subtitle="One tap with Apple or Google — no password to remember."
      onContinue={() => {}}
      canContinue={false}
      hideFooter
      onBack={() => router.back()}
    >
      <View style={s.wrap}>
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={s.btns}>
          <AnimatedPress
            style={[s.apple, busy ? s.dim : undefined]}
            onPress={handleApple}
            disabled={busy}
            haptic
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple"
          >
            <Ionicons name="logo-apple" size={20} color={EDITORIAL.cream} />
            <Text style={s.appleTxt}>{appleLoading ? 'Signing in...' : 'Continue with Apple'}</Text>
          </AnimatedPress>

          <AnimatedPress
            style={[s.google, busy ? s.dim : undefined]}
            onPress={handleGoogle}
            disabled={busy}
            haptic
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
          >
            <Ionicons name="logo-google" size={20} color={EDITORIAL.text} />
            <Text style={s.googleTxt}>{googleLoading ? 'Signing in...' : 'Continue with Google'}</Text>
          </AnimatedPress>

          {__DEV__ && (
            <AnimatedPress
              style={[s.google, busy ? s.dim : undefined]}
              onPress={handleDevLogin}
              disabled={busy}
              haptic
              accessibilityRole="button"
              accessibilityLabel="Dev login"
            >
              <Ionicons name="code-slash" size={20} color={EDITORIAL.textSoft} />
              <Text style={s.googleTxt}>{devLoading ? 'Signing in...' : 'Dev Login (skip auth)'}</Text>
            </AnimatedPress>
          )}
        </Animated.View>

        <Text style={s.legal}>By continuing you agree to our Terms of Service and Privacy Policy.</Text>
      </View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center' },
  btns: { gap: 12, marginBottom: 24 },
  apple: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: EDITORIAL.text, borderRadius: 32, paddingVertical: 18,
  },
  appleTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  google: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: EDITORIAL.creamCard, borderRadius: 32, paddingVertical: 18,
  },
  googleTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.text },
  dim: { opacity: 0.4 },
  legal: { fontFamily: FONTS.nunitoSans, fontSize: 12, textAlign: 'center', lineHeight: 18, color: EDITORIAL.textSoft },
});
