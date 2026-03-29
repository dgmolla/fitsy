import React from 'react';
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/lib/theme';

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const { name } = useLocalSearchParams<{ name?: string }>();

  const heading = name ? `You're in, ${name}!` : "You're in!";

  function goToMacroSetup() {
    router.replace('/macro-setup');
  }

  function goToSearch() {
    router.replace('/(tabs)/search');
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.emoji}>🥗</Text>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>{heading}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Fitsy finds restaurants near you with meals that match your protein,
            carb, and fat targets — so you can eat out without blowing your plan.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.ctaButton, { backgroundColor: colors.accent }]}
            onPress={goToMacroSetup}
            accessibilityRole="button"
            accessibilityLabel="Set up my macros"
          >
            <Text style={[styles.ctaText, { color: colors.accentOnAccent }]}>Set up my macros</Text>
          </Pressable>

          <Pressable
            style={styles.skipButton}
            onPress={goToSearch}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
            hitSlop={8}
          >
            <Text style={[styles.skipText, { color: colors.textTertiary }]}>Skip for now</Text>
          </Pressable>
        </View>
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
    paddingHorizontal: 32,
    justifyContent: 'center',
    gap: 48,
  },
  header: {
    alignItems: 'center',
    gap: 16,
  },
  emoji: {
    fontSize: 56,
  },
  heading: {
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  actions: {
    gap: 16,
    alignItems: 'center',
  },
  ctaButton: {
    width: '100%',
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '600',
  },
  skipButton: {
    paddingVertical: 8,
  },
  skipText: {
    fontSize: 15,
  },
});
