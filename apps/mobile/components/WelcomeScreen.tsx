import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { AnimatedPress } from './AnimatedPress';
import { WelcomeNav } from './WelcomeNav';

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
  beforeTitle?: React.ReactNode;
  footerContent?: React.ReactNode;
}

export function WelcomeScreen({
  step: _step,
  totalSteps: _totalSteps,
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
  beforeTitle,
  footerContent,
}: Props) {
  const navigation = useNavigation();
  const { height, fontScale } = useWindowDimensions();
  const compact = height < 780 && fontScale <= 1.2;

  const handleBack = onBack ?? (() => {
    if (navigation.canGoBack()) router.back();
  });

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <WelcomeNav progress={progress} onBack={showBack && (navigation.canGoBack() || onBack) ? handleBack : undefined} />

        {/* ── Body ── */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.body, compact && styles.bodyCompact]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {beforeTitle}
          <Animated.Text
            entering={FadeInDown.duration(500).delay(80)}
            style={[styles.title, compact && styles.titleCompact]}
          >
            {title}
          </Animated.Text>

          {subtitle && (
            <Animated.Text
              entering={FadeInDown.duration(500).delay(180)}
              style={[styles.subtitle, compact && styles.subtitleCompact]}
            >
              {subtitle}
            </Animated.Text>
          )}

          <Animated.View entering={FadeIn.duration(400).delay(280)} style={styles.childWrap}>
            {children}
          </Animated.View>
        </ScrollView>

        {/* ── Footer ── */}
        {footerContent ? <View style={[styles.customFooter, compact && styles.footerCompact]}>{footerContent}</View> : !hideFooter && (
          <Animated.View entering={FadeIn.duration(300).delay(400)} style={[styles.footer, compact && styles.footerCompact]}>
            <AnimatedPress
              style={[styles.continueBtn, !canContinue ? styles.continueDim : undefined]}
              onPress={onContinue}
              disabled={!canContinue}
              haptic
              accessibilityRole="button"
              accessibilityLabel={continueLabel}
              testID="welcome-continue"
            >
              <Text style={styles.continueTxt}>{continueLabel}</Text>
              <Ionicons name="arrow-forward" size={15} color={EDITORIAL.cream} />
            </AnimatedPress>
            {onSkip && <Pressable onPress={onSkip} style={styles.skipHit} accessibilityRole="button"
              accessibilityLabel="Skip" testID="welcome-skip"><Text style={styles.skipTxt}>Skip</Text></Pressable>}
          </Animated.View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  flex: { flex: 1 },

  body: {
    paddingHorizontal: 28,
    paddingTop: 18,
    paddingBottom: 12,
    flexGrow: 1,
  },
  bodyCompact: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 8 },
  title: {
    ...TEXT.headline,
    marginBottom: 10,
  },
  titleCompact: { fontSize: 28, lineHeight: 34, marginBottom: 6 },
  subtitle: {
    ...TEXT.subtitle,
    marginBottom: 18,
  },
  subtitleCompact: { marginBottom: 10 },
  childWrap: { flex: 1 },

  footer: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingBottom: 10,
    paddingTop: 4,
  },
  customFooter: { paddingHorizontal: 28, paddingTop: 4, paddingBottom: 10 },
  footerCompact: { paddingHorizontal: 24, paddingBottom: 4, paddingTop: 2 },
  skipHit: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  skipTxt: { ...TEXT.body, color: EDITORIAL.textSoft },

  continueBtn: {
    flexShrink: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 32,
  },
  continueDim: { opacity: 0.25 },
  continueTxt: { ...TEXT.cta, flexShrink: 1, textAlign: 'center' },
});
