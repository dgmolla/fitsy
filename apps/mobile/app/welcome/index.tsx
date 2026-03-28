import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ContinueButton } from '@/components/ContinueButton';

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoSection}>
          <View style={styles.logoMark}>
            <Ionicons name="leaf" size={48} color="#FFFFFF" />
          </View>
          <Text style={styles.wordmark}>fitsy</Text>
          <Text style={styles.tagline}>Find meals that match your macros</Text>
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
            <Text style={styles.emailLinkText}>Continue with Email</Text>
          </Pressable>
        </View>

        <Text style={styles.legal}>
          By continuing you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
    backgroundColor: '#2D7D46',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2D7D46',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  wordmark: {
    fontSize: 42,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 16,
    color: '#6B7280',
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
    color: '#2D7D46',
  },
  legal: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 18,
  },
});
