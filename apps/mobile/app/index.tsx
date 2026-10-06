import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Redirect, useNavigation } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOnboardingResume } from '@/lib/onboardingResume';
import { paywallVariants, readPaywallDecline } from '@/lib/paywallAccess';
import { ONBOARDING_COMPLETE_KEY } from '@/lib/onboardingCompletion';
import { getStoredToken } from '@/lib/authClient';
import { hasSavedMealTargets } from '@/lib/macroStorage';
import { readOnboardingPreviewEntry } from '@/lib/onboardingPreviewEntry';
import { usePurchases } from '@/lib/usePurchases';
import { onboardingEntry, type EntryDestination } from '@/lib/onboardingEntry';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { openPurchasedDestination } from '@/lib/paywallJourney';
import { replayPendingProfileSync } from '@/lib/profileSync';
import { recoverStartupMealTargets, type StartupTargetRecovery } from '@/lib/startupMacroRecovery';
import { confirmLegacyMacroRecovery } from '@/lib/macroRecoveryPrompt';

export default function Index() {
  const navigation = useNavigation();
  const [destination, setDestination] = useState<EntryDestination>(null);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const targetRecovery = useRef<{ token: string; pending: Promise<StartupTargetRecovery> } | null>(null);
  const { ready: purchasesReady, entitled, isLapsed, isUnknown, offering } = usePurchases();

  useEffect(() => {
    let current = true;
    async function resolve() {
      try {
        const [token, resume, declined, completed, targets, onboardingPreviewEntry] = await Promise.all([
          getStoredToken(), getOnboardingResume(), readPaywallDecline(),
          AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY), hasSavedMealTargets(), readOnboardingPreviewEntry(),
        ]);
        if (!current) return;
        setRecoveryUnavailable(false);
        if (token) void replayPendingProfileSync();
        if (token && purchasesReady && isUnknown) {
          setDestination('/welcome/subscription-check');
          return;
        }
        let hasTargets = targets;
        if (token && purchasesReady && entitled === true && !hasTargets) {
          if (targetRecovery.current?.token !== token) {
            targetRecovery.current = { token, pending: recoverStartupMealTargets(confirmLegacyMacroRecovery) };
          }
          const recovery = await targetRecovery.current.pending;
          if (!current) return;
          if (recovery === 'unavailable' || recovery === 'account-changed') {
            setRecoveryUnavailable(true);
            return;
          }
          hasTargets = recovery === 'restored';
        }
        if (token && purchasesReady && entitled === true && hasTargets) {
          const resumed = await openPurchasedDestination(navigation, { resumeOnly: true, isCurrent: () => current });
          if (!current || resumed) return;
        }
        setDestination(onboardingEntry({
          signedIn: !!token, resume, declined, completed: completed === 'true',
          hasTargets: !!hasTargets, purchasesReady, entitled, isLapsed, onboardingPreviewEntry,
          access: paywallVariants(offering?.metadata).access,
        }));
      } catch {
        if (current) setDestination('/welcome/problem');
      }
    }
    void resolve();
    return () => { current = false; };
  }, [purchasesReady, entitled, isLapsed, isUnknown, offering, navigation, recoveryAttempt]);

  if (recoveryUnavailable) {
    return (
      <View style={s.container}>
        <View style={s.recoveryContent}>
          <Text style={s.recoveryTitle}>Your saved targets</Text>
          <Text style={s.recoveryBody}>We could not load your account targets. Try again when you are connected.</Text>
          <Pressable testID="target-recovery-retry" accessibilityRole="button" style={s.recoveryButton} onPress={() => {
            targetRecovery.current = null;
            setRecoveryUnavailable(false);
            setRecoveryAttempt(attempt => attempt + 1);
          }}>
            <Text style={s.recoveryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!destination) {
    return (
      <View style={s.container}>
        <Animated.Text entering={FadeIn.duration(600)} style={s.wordmark}>
          fitsy
        </Animated.Text>
      </View>
    );
  }

  return <Redirect href={destination} />;
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: EDITORIAL.cream,
  },
  recoveryContent: { paddingHorizontal: 32, gap: 20, width: '100%' },
  recoveryTitle: { fontFamily: FONTS.frauncesDisplayBold, fontSize: 34, color: EDITORIAL.green },
  recoveryBody: { fontFamily: FONTS.nunitoSans, fontSize: 16, lineHeight: 24, color: EDITORIAL.textSoft },
  recoveryButton: { backgroundColor: EDITORIAL.green, borderRadius: 30, padding: 18, alignItems: 'center' },
  recoveryButtonText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, color: EDITORIAL.cream },
  wordmark: {
    fontFamily: FONTS.frauncesDisplayBold,
    fontSize: 52,
    color: EDITORIAL.green,
    letterSpacing: -2,
  },
});
