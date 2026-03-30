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
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import { useTheme } from '@/lib/theme';
import { ScreenBackground } from './ScreenBackground';

interface Props {
  step: number;
  totalSteps: number;
  illustration?: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onContinue: () => void;
  canContinue: boolean;
  continueLabel?: string;
  showBack?: boolean;
  onBack?: () => void;
  scrollable?: boolean;
  hideFooter?: boolean;
}

export function WelcomeScreen({
  step,
  totalSteps,
  illustration,
  title,
  subtitle,
  children,
  onContinue,
  canContinue,
  continueLabel = 'Continue',
  showBack = true,
  onBack,
  scrollable = false,
  hideFooter = false,
}: Props) {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const progress = step / totalSteps;

  const handleBack = onBack ?? (() => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.navigate('/welcome');
    }
  });

  const body = (
    <View>
      {illustration && <View style={styles.illustrationWrap}>{illustration}</View>}
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {subtitle}
      </Text>
      <View style={styles.childrenWrap}>{children}</View>
    </View>
  );

  return (
    <ScreenBackground>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header: back + progress */}
        <View style={styles.header}>
          {showBack ? (
            <Pressable
              onPress={handleBack}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={styles.backBtn}
            >
              <Ionicons name="chevron-back" size={24} color={colors.textSecondary} />
            </Pressable>
          ) : (
            <View style={styles.backBtn} />
          )}
          <View style={[styles.progressTrack, { backgroundColor: colors.borderSubtle }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: colors.accent, width: `${progress * 100}%` },
              ]}
            />
          </View>
          <View style={styles.backBtn} />
        </View>

        {/* Body + Footer */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {body}
          {!hideFooter && (
            <View style={styles.footer}>
              <Pressable
                style={[
                  styles.continueBtn,
                  { backgroundColor: colors.accent },
                  !canContinue && { opacity: 0.4 },
                ]}
                onPress={onContinue}
                disabled={!canContinue}
                accessibilityRole="button"
                accessibilityLabel={continueLabel}
                accessibilityState={{ disabled: !canContinue }}
              >
                <Text style={[styles.continueTxt, { color: colors.accentOnAccent }]}>
                  {continueLabel}
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: { width: 32 },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  illustrationWrap: {
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 28,
  },
  childrenWrap: {
    minHeight: 280,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    marginBottom: 24,
  },
  continueBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  continueTxt: {
    fontSize: 17,
    fontWeight: '700',
  },
});
