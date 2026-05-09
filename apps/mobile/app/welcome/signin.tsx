import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

import { Ionicons } from '@expo/vector-icons';
import { appleSignIn, completeGoogleSignIn } from '@/lib/authClient';
import { pullProfileFromServer } from '@/lib/profileSync';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { getMacroTargets } from '@/lib/macroStorage';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { identifyUser, trackAuthFailure, trackAuthSuccess, trackOnboardingScreenView } from '@/lib/analytics';
import { EDITORIAL } from '@/lib/brand';

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
            // Onboarding redirect chain (post sign-in):
            //   → /welcome/notification-permission (S-226b — needs auth for push-token POST)
            //   → /(tabs)/search
            // (location-permission runs upstream, after welcome/tuning, so the
            //  teaser prefetch in welcome/finding can use granted coords.)
            router.replace('/welcome/notification-permission');
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
      // location-permission runs upstream now (after welcome/tuning); after
      // signin we go straight to the notification priming screen, which needs
      // an authed user for the push-token POST.
      router.replace('/welcome/notification-permission');
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

  const busy = appleLoading || googleLoading;

  return (
    <WelcomeScreen
      title="Almost there."
      subtitle="Create an account to save your targets."
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
  appleTxt: { fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  google: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: EDITORIAL.creamCard, borderRadius: 32, paddingVertical: 18,
  },
  googleTxt: { fontSize: 16, fontWeight: '600', color: EDITORIAL.text },
  dim: { opacity: 0.4 },
  legal: { fontSize: 12, textAlign: 'center', lineHeight: 18, color: EDITORIAL.textSoft },
});
