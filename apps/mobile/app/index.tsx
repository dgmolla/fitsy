import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Redirect, useNavigation } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOnboardingResume } from '@/lib/onboardingResume';
import { paywallVariants, readPaywallDecline } from '@/lib/paywallAccess';
import { ONBOARDING_COMPLETE_KEY } from '@/lib/onboardingCompletion';
import { getStoredToken } from '@/lib/authClient';
import { supabase } from '@/lib/supabase';
import { getMacroTargets, hasSavedMealTargets } from '@/lib/macroStorage';
import { readOnboardingPreviewEntry } from '@/lib/onboardingPreviewEntry';
import { BOOT_VERDICT_CAP_MS, usePurchases } from '@/lib/usePurchases';
import { onboardingEntry, type EntryDestination } from '@/lib/onboardingEntry';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { openPurchasedDestination } from '@/lib/paywallJourney';
import { replayPendingProfileSync } from '@/lib/profileSync';
import { recoverStartupMealTargets, type StartupTargetRecovery } from '@/lib/startupMacroRecovery';
import { confirmLegacyMacroRecovery } from '@/lib/macroRecoveryPrompt';
import { bindPaymentSignInContinuation, clearPaymentSignInContinuation, hasPaymentSignInContinuation } from '@/lib/paymentSignInContinuation';
import { claimPaywallIntent, clearPaywallIntent, markPurchasedContinuation } from '@/lib/paywallIntent';
import { clearPendingMealClaim, hasPendingMealClaim } from '@/lib/pendingMealClaim';
import { withinMs } from '@/lib/async';
import { PurchaseIdentityRecovery } from '@/components/PurchaseIdentityRecovery';

export default function Index() {
  const navigation = useNavigation();
  const [destination, setDestination] = useState<EntryDestination>(null);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const targetRecovery = useRef<{ token: string; pending: Promise<StartupTargetRecovery> } | null>(null);
  const [identityUnavailable, setIdentityUnavailable] = useState(false);
  const [identityAttempt, setIdentityAttempt] = useState(0);
  const { ready: purchasesReady, entitled, isLapsed, isUnknown, offering } = usePurchases();

  useEffect(() => {
    let current = true;
    setIdentityUnavailable(false);
    async function resolve() {
      try {
        const startupRead = Promise.all([
          getStoredToken(), getOnboardingResume(), readPaywallDecline(),
          AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY), hasSavedMealTargets(), readOnboardingPreviewEntry(),
          hasPaymentSignInContinuation(), hasPendingMealClaim(),
        ]);
        let startup = await withinMs(startupRead, BOOT_VERDICT_CAP_MS);
        if (!current) return;
        if (!startup) {
          // getStoredToken also reads the SDK session. Bound the entire
          // persisted-state prerequisite, not only the later identity claim.
          setIdentityUnavailable(true);
          startup = await startupRead;
          if (!current) return;
          setIdentityUnavailable(false);
        }
        const [token, resume, declined, completed, targets, onboardingPreviewEntry, savedPaymentContinuation, pendingMealClaim] = startup;
        if (!current) return;
        setRecoveryUnavailable(false);
        if (token) void replayPendingProfileSync();
        if (resume === '/welcome/out-of-area') {
          // A prior checkout cannot replace a waitlist signup, including
          // after authentication finishes but before its callback navigates.
          await Promise.allSettled([clearPaymentSignInContinuation(), clearPendingMealClaim(), clearPaywallIntent()]);
          if (current) setDestination('/welcome/out-of-area');
          return;
        }
        let paymentSignInContinuation = savedPaymentContinuation;
        let mealClaim = pendingMealClaim;
        let resumedSelectionUserId: string | null = null;
        if (token && (paymentSignInContinuation || pendingMealClaim)) {
          // Authentication can persist its session before sign-in claims the
          // anonymous meal. Recover that handoff before routing a cold start.
          const sessionRead = supabase.auth.getSession();
          let result = await withinMs(sessionRead, BOOT_VERDICT_CAP_MS);
          if (!current) return;
          if (!result) {
            setIdentityUnavailable(true);
            // Keep the claim intact for retry; an eventual answer may recover
            // this attempt only while it is still the current root journey.
            result = await sessionRead;
            if (!current) return;
            setIdentityUnavailable(false);
          }
          const { data } = result;
          if (!current) return;
          if (data.session?.user.id) {
            const userId = data.session.user.id;
            if (paymentSignInContinuation) {
              paymentSignInContinuation = await bindPaymentSignInContinuation(userId);
              if (!paymentSignInContinuation) {
                // A different account owns the interrupted checkout. Reject
                // its anonymous meal before any other pending claim can run.
                await Promise.all([clearPaywallIntent(), clearPendingMealClaim()]);
                mealClaim = false;
              }
            }
            if (paymentSignInContinuation || mealClaim) {
              await claimPaywallIntent(userId);
              resumedSelectionUserId = userId;
            }
            if (!current) return;
          }
        }
        if (token && purchasesReady && isUnknown) {
          setDestination('/welcome/subscription-check');
          return;
        }
        if (resumedSelectionUserId && purchasesReady && !isUnknown) {
          if (entitled === true) {
            // A settled active account may need setup before opening its meal.
            await markPurchasedContinuation();
            if (paymentSignInContinuation) await clearPaymentSignInContinuation();
          }
          if (mealClaim) await clearPendingMealClaim();
          if (!current) return;
        }
        let hasTargets = targets;
        if (token && purchasesReady && entitled === true && !await getMacroTargets()) {
          if (targetRecovery.current?.token !== token) {
            targetRecovery.current = { token, pending: recoverStartupMealTargets(confirmLegacyMacroRecovery) };
          }
          const recovery = await targetRecovery.current.pending;
          if (!current) return;
          if (recovery === 'account-changed') return;
          if (recovery === 'unavailable' && !targets) {
            setRecoveryUnavailable(true);
            return;
          }
          hasTargets = targets || recovery === 'restored';
        }
        if (token && purchasesReady && entitled === true && hasTargets) {
          const resumed = await openPurchasedDestination(navigation, { resumeOnly: true, isCurrent: () => current });
          if (!current || resumed) return;
        }
        setDestination(onboardingEntry({
          signedIn: !!token, resume, declined, completed: completed === 'true',
          hasTargets: !!hasTargets, purchasesReady, entitled, isLapsed, onboardingPreviewEntry,
          access: paywallVariants(offering?.metadata).access, paymentSignInContinuation, pendingMealClaim: mealClaim,
        }));
      } catch {
        if (current) setDestination('/welcome/problem');
      }
    }
    void resolve();
    return () => { current = false; };
  }, [purchasesReady, entitled, isLapsed, isUnknown, offering, navigation, recoveryAttempt, identityAttempt]);

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

  if (identityUnavailable) return <PurchaseIdentityRecovery onRetry={() => setIdentityAttempt(attempt => attempt + 1)} />;

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
