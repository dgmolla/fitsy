import React, { useEffect, useState } from 'react';
import { Alert, Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { Ionicons } from '@expo/vector-icons';
import { appleSignIn, completeGoogleSignIn } from '@/lib/authClient';
import { useTheme } from '@/lib/theme';
import { BRAND } from '@/lib/brand';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

export default function WelcomeSplash() {
  const { colors } = useTheme();
  const [appleLoading, setAppleLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Fallback to placeholder so the hook doesn't throw when env var is unset.
  // handleGoogleSignIn guards against calling promptGoogleAsync without a real client ID.
  const [, response, promptGoogleAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID ?? 'not-configured',
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params['id_token'];
      if (idToken) {
        setGoogleLoading(true);
        completeGoogleSignIn(idToken)
          .then((result) => {
            setGoogleLoading(false);
            if (result.isNewUser) {
              router.replace('/welcome/age');
            } else {
              router.replace('/(tabs)/search');
            }
          })
          .catch((err: Error) => {
            setGoogleLoading(false);
            Alert.alert('Sign In Failed', err.message);
          });
      }
    } else if (response?.type === 'error') {
      Alert.alert('Google Sign In Error', response.error?.message ?? 'Unknown error');
    }
  }, [response]);

  async function handleAppleSignIn() {
    setAppleLoading(true);
    try {
      const result = await appleSignIn();
      if (result.isNewUser) {
        router.replace('/welcome/age');
      } else {
        router.replace('/(tabs)/search');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apple Sign In failed';
      if (!msg.includes('canceled')) {
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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        {/* Hero */}
        <View style={styles.hero}>
          <Image source={require('@/assets/illustrations/welcome.png')} style={{ width: 200, height: 200, resizeMode: 'contain' }} />
          <Text style={[styles.wordmark, { color: BRAND.color }]}>
            {BRAND.name}
          </Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            Eat well, wherever you go.
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            style={[styles.appleBtn, { backgroundColor: colors.textPrimary }, appleLoading && styles.disabled]}
            onPress={handleAppleSignIn}
            disabled={appleLoading || googleLoading}
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple"
          >
            <Ionicons name="logo-apple" size={20} color={colors.bg} />
            <Text style={[styles.appleTxt, { color: colors.bg }]}>
              {appleLoading ? 'Signing in…' : 'Continue with Apple'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.googleBtn, { borderColor: colors.border }, googleLoading && styles.disabled]}
            onPress={handleGoogleSignIn}
            disabled={appleLoading || googleLoading}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
          >
            <Ionicons name="logo-google" size={20} color={colors.textPrimary} />
            <Text style={[styles.googleTxt, { color: colors.textPrimary }]}>
              {googleLoading ? 'Signing in…' : 'Continue with Google'}
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.legal, { color: colors.textTertiary }]}>
          By continuing you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingBottom: 32,
  },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  wordmark: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: BRAND.letterSpacing,
  },
  tagline: { fontSize: 16, textAlign: 'center' },
  actions: { gap: 12, marginBottom: 16 },
  appleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  appleTxt: { fontSize: 16, fontWeight: '600' },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 1.5,
  },
  googleTxt: { fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  legal: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
