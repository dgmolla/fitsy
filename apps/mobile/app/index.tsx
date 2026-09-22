import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Redirect, useNavigation } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOnboardingResume } from '@/lib/onboardingResume';
import { paywallVariants, readPaywallDecline } from '@/lib/paywallAccess';
import { ONBOARDING_COMPLETE_KEY } from '@/lib/onboardingCompletion';
import { getStoredToken } from '@/lib/authClient';
import { getMacroTargets } from '@/lib/macroStorage';
import { usePurchases } from '@/lib/usePurchases';
import { onboardingEntry, type EntryDestination } from '@/lib/onboardingEntry';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { openPurchasedDestination } from '@/lib/paywallJourney';

export default function Index() {
  const navigation = useNavigation();
  const [destination, setDestination] = useState<EntryDestination>(null);
  const { ready: purchasesReady, entitled, isLapsed, offering } = usePurchases();

  useEffect(() => {
    let current = true;
    async function resolve() {
      try {
        const [token, resume, declined, completed, targets] = await Promise.all([
          getStoredToken(), getOnboardingResume(), readPaywallDecline(),
          AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY), getMacroTargets(),
        ]);
        if (!current) return;
        if (token && purchasesReady && entitled === true && targets) {
          const resumed = await openPurchasedDestination(navigation, { resumeOnly: true, isCurrent: () => current });
          if (!current || resumed) return;
        }
        setDestination(onboardingEntry({
          signedIn: !!token, resume, declined, completed: completed === 'true',
          hasTargets: !!targets, purchasesReady, entitled, isLapsed,
          access: paywallVariants(offering?.metadata).access,
        }));
      } catch {
        if (current) setDestination('/welcome/problem');
      }
    }
    void resolve();
    return () => { current = false; };
  }, [purchasesReady, entitled, isLapsed, offering, navigation]);

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
