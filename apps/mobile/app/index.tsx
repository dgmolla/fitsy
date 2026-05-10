import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Redirect } from 'expo-router';
import { getStoredToken } from '@/lib/authClient';
import { getMacroTargets } from '@/lib/macroStorage';
import { EDITORIAL, FONTS } from '@/lib/brand';

type Destination = '/(tabs)/search' | '/welcome/problem' | '/macro-setup';

export default function Index() {
  const [destination, setDestination] = useState<Destination | null>(null);

  useEffect(() => {
    async function resolve() {
      try {
        const token = await getStoredToken();
        if (!token) {
          setDestination('/welcome/problem');
          return;
        }
        const targets = await getMacroTargets();
        setDestination(targets ? '/(tabs)/search' : '/macro-setup');
      } catch {
        setDestination('/welcome/problem');
      }
    }
    resolve();
  }, []);

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
    fontFamily: FONTS.frauncesBold,
    fontSize: 52,
    color: EDITORIAL.green,
    letterSpacing: -2,
  },
});
