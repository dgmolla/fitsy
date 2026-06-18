import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { loginAndStore } from '@/lib/authClient';
import { isReviewEmail } from '@/lib/reviewAccess';
import { BRAND, EDITORIAL, FONTS } from '@/lib/brand';

// App Review-only sign-in. Intentionally NOT linked from anywhere in the app —
// App Review reaches it via the documented deep link `fitsy://auth/reviewer`.
// It uses the same Supabase email/password auth as the rest of the app, and
// pairs with the `DEMO_REVIEW_EMAILS` server bypass + the `useIsReviewer`
// paywall bypass so the reviewer sees the full app without a subscription.
//
// Guardrail: this screen only accepts allowlisted review emails, so it is not a
// generic email/password backdoor — it works for the review account or nothing.
export default function ReviewerSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    const trimmed = email.trim();
    if (!trimmed || !password) return;
    if (!isReviewEmail(trimmed)) {
      Alert.alert('Not a review account', 'This sign-in is reserved for App Store review.');
      return;
    }
    setLoading(true);
    try {
      await loginAndStore(trimmed, password);
      router.replace('/(tabs)/search');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign in failed';
      Alert.alert('Sign in failed', msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.inner}>
          <Text style={s.logo}>{BRAND.name}</Text>
          <Text style={s.title}>App Review access</Text>
          <Text style={s.sub}>Sign in with the demo account from the review notes.</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={EDITORIAL.textSoft}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            accessibilityLabel="Email"
          />
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={EDITORIAL.textSoft}
            secureTextEntry
            textContentType="password"
            accessibilityLabel="Password"
            onSubmitEditing={handleSignIn}
            returnKeyType="go"
          />
          <Pressable
            style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
            onPress={handleSignIn}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
          >
            {loading ? (
              <ActivityIndicator color={EDITORIAL.cream} />
            ) : (
              <Text style={s.btnTxt}>Sign in</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: EDITORIAL.cream },
  flex: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  logo: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 42,
    color: EDITORIAL.green,
    letterSpacing: -2,
    marginBottom: 2,
  },
  title: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 18, fontWeight: '700', color: EDITORIAL.text },
  sub: { fontFamily: FONTS.nunitoSans, fontSize: 13, color: EDITORIAL.textMid, marginBottom: 8 },
  input: {
    backgroundColor: EDITORIAL.creamCard,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: EDITORIAL.text,
  },
  btn: {
    backgroundColor: EDITORIAL.green,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 6,
  },
  btnPressed: { opacity: 0.85 },
  btnTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, color: EDITORIAL.cream, fontWeight: '700' },
});
