import React from 'react';
import { Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { BRAND } from '@/lib/brand';

export default function WelcomeSplash() {
  const { colors } = useTheme();

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
            style={[styles.appleBtn, { backgroundColor: colors.textPrimary }]}
            onPress={() => router.push('/welcome/age')}
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple"
          >
            <Ionicons name="logo-apple" size={20} color={colors.bg} />
            <Text style={[styles.appleTxt, { color: colors.bg }]}>
              Continue with Apple
            </Text>
          </Pressable>

          <Pressable
            style={[styles.emailBtn, { borderColor: colors.border }]}
            onPress={() => router.push('/welcome/email')}
            accessibilityRole="button"
            accessibilityLabel="Continue with Email"
          >
            <Ionicons name="mail-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.emailTxt, { color: colors.textPrimary }]}>
              Continue with Email
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
  emailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 1.5,
  },
  emailTxt: { fontSize: 16, fontWeight: '600' },
  legal: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
