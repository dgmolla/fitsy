import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ContinueButton } from '@/components/ContinueButton';
import { useTheme } from '@/lib/theme';
import { BRAND } from '@/lib/brand';

export default function WelcomeScreen() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        <View style={styles.logoSection}>
          <View
            style={[
              styles.logoMark,
              {
                backgroundColor: colors.accent,
                shadowColor: colors.glassShadowColor,
                shadowOpacity: colors.glassShadowOpacity,
              },
            ]}
          >
            <Ionicons name="leaf" size={48} color={colors.accentOnAccent} />
          </View>
          <Text style={[styles.wordmark, { color: colors.textPrimary }]}>{BRAND.name}</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>Find meals that match your macros</Text>
        </View>

        <View style={styles.actions}>
          <ContinueButton
            label="Continue with Apple"
            onPress={() => router.push('/welcome/age')}
          />
          <Pressable
            style={styles.emailLink}
            onPress={() => router.push('/welcome/age')}
            accessibilityRole="button"
            accessibilityLabel="Continue with Email"
          >
            <Text style={[styles.emailLinkText, { color: BRAND.color }]}>Continue with Email</Text>
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
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 32,
  },
  logoSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  logoMark: {
    width: 88,
    height: 88,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
  wordmark: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: BRAND.letterSpacing,
  },
  tagline: {
    fontSize: 16,
    textAlign: 'center',
  },
  actions: {
    gap: 12,
    marginBottom: 16,
  },
  emailLink: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  emailLinkText: {
    fontSize: 16,
    fontWeight: '500',
  },
  legal: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
