import React, { useEffect, useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { appleSignIn, completeGoogleSignIn } from '@/lib/authClient';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { useTheme } from '@/lib/theme';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

export default function SignInScreen() {
  const { colors } = useTheme();
  const [appleLoading, setAppleLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [, response, promptGoogleAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID ?? 'not-configured',
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params['id_token'];
      if (idToken) {
        setGoogleLoading(true);
        completeGoogleSignIn(idToken)
          .then(() => {
            setGoogleLoading(false);
            router.replace('/welcome/payment');
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
      await appleSignIn();
      router.replace('/welcome/payment');
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

  const isLoading = appleLoading || googleLoading;

  return (
    <WelcomeScreen
      step={6}
      totalSteps={7}
      illustration={
        <Image
          source={require('@/assets/illustrations/welcome.png')}
          style={{ width: 200, height: 200, resizeMode: 'contain' }}
        />
      }
      title="Create your account"
      subtitle="Save your targets and start finding meals that fit your goals."
      onContinue={() => {}}
      canContinue={false}
      hideFooter={true}
    >
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
            {appleLoading ? 'Signing in…' : 'Continue with Apple'}
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
            {googleLoading ? 'Signing in…' : 'Continue with Google'}
          </Text>
        </Pressable>
      </View>

      <Text style={[styles.legal, { color: colors.textTertiary }]}>
        By continuing you agree to our Terms of Service and Privacy Policy.
      </Text>
    </WelcomeScreen>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: 12, marginBottom: 16 },
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
  legal: { fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 8 },
});
