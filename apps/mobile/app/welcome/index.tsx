import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { BRAND } from '@/lib/brand';

function NatureScene() {
  const { colors } = useTheme();
  const green = colors.accent;
  const dim = colors.textTertiary;
  return (
    <View style={sceneStyles.wrap}>
      <Ionicons name="sunny" size={28} color="#F59E0B" style={sceneStyles.sun} />
      <View style={sceneStyles.row}>
        <Ionicons name="leaf" size={22} color={dim} style={sceneStyles.leafL} />
        <Ionicons name="leaf" size={36} color={green} />
        <Ionicons name="leaf" size={22} color={dim} style={sceneStyles.leafR} />
      </View>
      <View style={[sceneStyles.ground, { backgroundColor: colors.accentBg }]}>
        <Ionicons name="ellipse" size={8} color={colors.accentBorder} />
        <Ionicons name="ellipse" size={6} color={colors.accentBorder} />
        <Ionicons name="ellipse" size={8} color={colors.accentBorder} />
      </View>
    </View>
  );
}

export default function WelcomeSplash() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        {/* Hero */}
        <View style={styles.hero}>
          <NatureScene />
          <View
            style={[
              styles.logoMark,
              { backgroundColor: colors.accent, shadowColor: colors.glassShadowColor },
            ]}
          >
            <Ionicons name="leaf" size={44} color={colors.accentOnAccent} />
          </View>
          <Text style={[styles.wordmark, { color: colors.textPrimary }]}>
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
            onPress={() => router.push('/welcome/age')}
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

const sceneStyles = StyleSheet.create({
  wrap: { alignItems: 'center', marginBottom: 16 },
  sun: { marginBottom: -4 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  leafL: { transform: [{ rotate: '-30deg' }], marginBottom: 4 },
  leafR: { transform: [{ rotate: '30deg' }], marginBottom: 4 },
  ground: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 32,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 4,
  },
});

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
  logoMark: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
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
