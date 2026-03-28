import React, { useEffect, useState } from 'react';
import { Stack, Redirect } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function RootLayout() {
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('onboardingComplete').then((value) => {
      setOnboardingComplete(value === 'true');
    });
  }, []);

  if (onboardingComplete === null) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="welcome" />
      </Stack>
      {!onboardingComplete ? (
        <Redirect href="/welcome" />
      ) : (
        <Redirect href="/(tabs)" />
      )}
    </SafeAreaProvider>
  );
}
