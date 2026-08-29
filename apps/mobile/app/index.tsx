import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Redirect } from 'expo-router';
import { getStoredToken } from '@/lib/authClient';
import { getMacroTargets } from '@/lib/macroStorage';
import { usePurchases } from '@/lib/usePurchases';
import { EDITORIAL, FONTS } from '@/lib/brand';

type Destination = '/(tabs)/search' | '/welcome/problem' | '/macro-setup' | '/welcome/resubscribe';

export default function Index() {
  const [destination, setDestination] = useState<Destination | null>(null);
  const { ready: purchasesReady, isLapsed } = usePurchases();

  useEffect(() => {
    async function resolve() {
      try {
        const token = await getStoredToken();
        if (!token) {
          setDestination('/welcome/problem');
          return;
        }
        const targets = await getMacroTargets();
        if (!targets) {
          setDestination('/macro-setup');
          return;
        }
        // Wait for RevenueCat's first CustomerInfo read so a lapsed subscriber
        // gets the win-back screen instead of a flash of the search tab.
        if (!purchasesReady) return;
        setDestination(isLapsed ? '/welcome/resubscribe' : '/(tabs)/search');
      } catch {
        setDestination('/welcome/problem');
      }
    }
    resolve();
  }, [purchasesReady, isLapsed]);

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
