import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { ScreenBackground } from '@/components/ScreenBackground';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { appleSignIn, completeGoogleSignIn, devLogin } from '@/lib/authClient';
import { pullProfileFromServer } from '@/lib/profileSync';
import { useTheme } from '@/lib/theme';
import { BRAND, EDITORIAL, FONTS } from '@/lib/brand';
import { getMacroTargets } from '@/lib/macroStorage';
import { getOnboardingData } from '@/lib/onboardingStorage';
import { identifyUser, trackAuthFailure, trackAuthSuccess } from '@/lib/analytics';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

async function captureIdentity(userId: string, email?: string | null): Promise<void> {
  const [macroTargets, onboardingData] = await Promise.all([
    getMacroTargets(),
    getOnboardingData(),
  ]);
  identifyUser(userId, {
    email: email ?? undefined,
    goal: onboardingData.goal,
    activity_level: onboardingData.activity,
    macro_protein: macroTargets?.protein != null ? Number(macroTargets.protein) : undefined,
    macro_carbs: macroTargets?.carbs != null ? Number(macroTargets.carbs) : undefined,
    macro_fat: macroTargets?.fat != null ? Number(macroTargets.fat) : undefined,
    macro_calories: macroTargets?.calories != null ? Number(macroTargets.calories) : undefined,
  });
}

export default function LoginScreen() {
  const { colors } = useTheme();
  const [appleLoading, setAppleLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [, response, promptGoogleAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID ?? 'not-configured',
    clientId: GOOGLE_WEB_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params['id_token'];
      if (idToken) {
        setGoogleLoading(true);
        completeGoogleSignIn(idToken)
          .then(async (result) => {
            trackAuthSuccess({ provider: 'google', is_new_user: result.isNewUser });
            await captureIdentity(result.user.id, result.user.email);
            await pullProfileFromServer();
            setGoogleLoading(false);
            router.replace('/(tabs)/search');
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

  async function handleAppleSignIn() {
    setAppleLoading(true);
    try {
      const result = await appleSignIn();
      trackAuthSuccess({ provider: 'apple', is_new_user: result.isNewUser });
      await captureIdentity(result.user.id, result.user.email);
      if (!result.isNewUser) await pullProfileFromServer();
      router.replace('/(tabs)/search');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apple Sign In failed';
      if (!msg.includes('canceled')) {
        trackAuthFailure({ provider: 'apple', error_message: msg });
        Alert.alert('Sign In Failed', msg);
      }
    } finally {
      setAppleLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!GOOGLE_IOS_CLIENT_ID) {
      Alert.alert('Not Configured', 'Google Sign In is not configured yet.');
      return;
    }
    await promptGoogleAsync();
  }

  const [devLoading, setDevLoading] = useState(false);

  async function handleDevLogin() {
    setDevLoading(true);
    try {
      const r = await devLogin();
      trackAuthSuccess({ provider: 'dev', is_new_user: false });
      await captureIdentity(r.user.id, r.user.email);
      router.replace('/(tabs)/search');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Dev login failed';
      trackAuthFailure({ provider: 'dev', error_message: msg });
      Alert.alert('Dev Login Failed', msg);
    } finally {
      setDevLoading(false);
    }
  }

  const isLoading = appleLoading || googleLoading || devLoading;

  return (
    <ScreenBackground>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.logo}>{BRAND.name}</Text>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Welcome back</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Sign in to continue finding meals that fit your goals.
          </Text>
        </View>

        <View style={styles.buttons}>
          <Pressable
            style={[styles.appleBtn, { backgroundColor: colors.textPrimary }, isLoading && styles.disabled]}
            onPress={handleAppleSignIn}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple"
          >
            <Ionicons name="logo-apple" size={20} color={colors.bg} />
            <Text style={[styles.appleTxt, { color: colors.bg }]}>
              {appleLoading ? 'Signing in...' : 'Continue with Apple'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.googleBtn, { borderColor: colors.border }, isLoading && styles.disabled]}
            onPress={handleGoogleSignIn}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
          >
            <Ionicons name="logo-google" size={20} color={colors.textPrimary} />
            <Text style={[styles.googleTxt, { color: colors.textPrimary }]}>
              {googleLoading ? 'Signing in...' : 'Continue with Google'}
            </Text>
          </Pressable>

          {__DEV__ && (
            <Pressable
              style={[styles.googleBtn, { borderColor: colors.border }, isLoading && styles.disabled]}
              onPress={handleDevLogin}
              disabled={isLoading}
              accessibilityRole="button"
            >
              <Ionicons name="code-slash" size={20} color={colors.textTertiary} />
              <Text style={[styles.googleTxt, { color: colors.textTertiary }]}>
                {devLoading ? 'Signing in...' : 'Dev Login (skip auth)'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 40 },
  header: { gap: 8 },
  logo: { fontFamily: FONTS.frauncesDisplay, fontSize: 42, color: EDITORIAL.green, letterSpacing: -2, marginBottom: 8 },
  title: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 28, fontWeight: '700' },
  subtitle: { fontFamily: FONTS.nunitoSans, fontSize: 15, lineHeight: 22 },
  buttons: { gap: 12 },
  appleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    paddingVertical: 16,
  },
  appleTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600' },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 1.5,
  },
  googleTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
