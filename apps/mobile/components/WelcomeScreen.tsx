import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from './AnimatedPress';

interface Props {
  step?: number;
  totalSteps?: number;
  /** Progress fraction 0–1. Shown as a bar. Overrides step/totalSteps display. */
  progress?: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onContinue: () => void;
  canContinue: boolean;
  continueLabel?: string;
  onSkip?: () => void;
  showBack?: boolean;
  onBack?: () => void;
  hideFooter?: boolean;
}

export function WelcomeScreen({
  step,
  totalSteps,
  progress,
  title,
  subtitle,
  children,
  onContinue,
  canContinue,
  continueLabel = 'Continue',
  onSkip,
  showBack = true,
  onBack,
  hideFooter = false,
}: Props) {
  const navigation = useNavigation();

  const handleBack = onBack ?? (() => {
    if (navigation.canGoBack()) router.back();
    else router.navigate('/welcome/problem');
  });

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* ── Top bar ── */}
        <View style={styles.topBar}>
          {showBack ? (
            <Pressable
              onPress={handleBack}
              hitSlop={16}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={styles.backHit}
            >
              <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
            </Pressable>
          ) : (
            <View style={styles.backHit} />
          )}
          {progress != null && (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
          )}
        </View>

        {/* ── Body ── */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <Animated.Text
            entering={FadeInDown.duration(500).delay(80)}
            style={styles.title}
          >
            {title}
          </Animated.Text>

          {subtitle && (
            <Animated.Text
              entering={FadeInDown.duration(500).delay(180)}
              style={styles.subtitle}
            >
              {subtitle}
            </Animated.Text>
          )}

          <Animated.View entering={FadeIn.duration(400).delay(280)} style={styles.childWrap}>
            {children}
          </Animated.View>
        </ScrollView>

        {/* ── Footer ── */}
        {!hideFooter && (
          <Animated.View entering={FadeIn.duration(300).delay(400)} style={styles.footer}>
            {onSkip ? (
              <Pressable
                onPress={onSkip}
                hitSlop={16}
                style={styles.skipHit}
                accessibilityRole="button"
                accessibilityLabel="Skip"
              >
                <Text style={styles.skipTxt}>Skip</Text>
              </Pressable>
            ) : (
              <View style={styles.skipHit} />
            )}

            <AnimatedPress
              style={[styles.continueBtn, !canContinue ? styles.continueDim : undefined]}
              onPress={onContinue}
              disabled={!canContinue}
              haptic
              accessibilityRole="button"
              accessibilityLabel={continueLabel}
            >
              <Text style={styles.continueTxt}>{continueLabel}</Text>
              <Ionicons name="arrow-forward" size={15} color={EDITORIAL.cream} />
            </AnimatedPress>
          </Animated.View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  flex: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    height: 52,
  },
  backHit: { width: 44, height: 44, justifyContent: 'center' },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: EDITORIAL.border,
    borderRadius: 2,
    marginLeft: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: EDITORIAL.greenAccent,
    borderRadius: 2,
  },

  body: {
    paddingHorizontal: 36,
    paddingTop: 0,
    paddingBottom: 24,
    flexGrow: 1,
  },
  title: {
    // Display cut at the webapp's hero settings: opsz=144 + wght=400 are baked
    // into the .ttf (instanced from the variable source). This selects the
    // high-contrast display letterforms instead of the chunky body cut that
    // `frauncesBold` produced at headline sizes.
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 30,
    color: EDITORIAL.text,
    letterSpacing: -0.8,
    lineHeight: 36,
    marginBottom: 14,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: EDITORIAL.textSoft,
    marginBottom: 36,
  },
  childWrap: { flex: 1 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
    paddingBottom: 16,
    paddingTop: 8,
  },
  skipHit: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  skipTxt: { fontSize: 15, color: EDITORIAL.textSoft },

  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 32,
  },
  continueDim: { opacity: 0.25 },
  continueTxt: { fontSize: 15, fontWeight: '600', color: EDITORIAL.cream },
});
