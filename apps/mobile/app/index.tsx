import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOnboardingResume } from '@/lib/onboardingResume';
import { readPaywallDecline } from '@/lib/paywallAccess';
import { ONBOARDING_COMPLETE_KEY } from '@/lib/onboardingCompletion';
import { getStoredToken } from '@/lib/authClient';
import { getMacroTargets } from '@/lib/macroStorage';
import { usePurchases } from '@/lib/usePurchases';
import { EDITORIAL, FONTS } from '@/lib/brand';

type Destination = Awaited<ReturnType<typeof getOnboardingResume>> | '/welcome/payment' | '/(tabs)/search' | '/welcome/problem' | '/macro-setup' | '/welcome/resubscribe';

export default function Index() {
  const [destination, setDestination] = useState<Destination | null>(null);
  const { ready: purchasesReady, entitled, isLapsed } = usePurchases();

  useEffect(() => {
    async function resolve() {
      try {
        const [token, resume, declined, completed] = await Promise.all([
          getStoredToken(), getOnboardingResume(), readPaywallDecline(), AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY),
        ]);
        if (!isLapsed && completed !== 'true' && resume && !declined && entitled !== true) {
          setDestination(token && resume === '/welcome/signin' ? '/welcome/trial' : resume);
          return;
        }
        if (declined && !token) { setDestination('/welcome/payment'); return; }
        if (!token) {
          setDestination('/welcome/problem');
          return;
        }
        const targets = await getMacroTargets();
        if (!targets) {
          setDestination('/macro-setup');
          return;
        }
        // Wait for the provider's verdict to settle (`ready` is exactly
        // `entitled !== null`: the server answered, or the cache / device
        // stood in once BOOT_VERDICT_CAP_MS passed) so a lapsed subscriber
        // gets the win-back screen instead of a flash of the search tab, and
        // the tab layout's gate has a settled verdict the moment it mounts.
        if (!purchasesReady) return;
        // The server verdict wins: an active row goes straight to search even
        // if the device's RevenueCat record reads as lapsed. Only an
        // unentitled lapsed subscriber gets the win-back screen.
        setDestination(entitled === true || !isLapsed ? '/(tabs)/search' : '/welcome/resubscribe');
      } catch {
        setDestination('/welcome/problem');
      }
    }
    resolve();
  }, [purchasesReady, entitled, isLapsed]);

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
  wordmark: {
    fontFamily: FONTS.frauncesDisplayBold,
    fontSize: 52,
    color: EDITORIAL.green,
    letterSpacing: -2,
  },
});
