import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { WelcomeActions } from '@/components/WelcomeActions';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { trackOnboardingScreenView } from '@/lib/analytics';

export default function PromiseScreen() {
  useOnboardingStep('promise');
  useEffect(() => { trackOnboardingScreenView('promise'); }, []);
  return <WelcomeScreen title={"Let’s find your\nnext favorite bite"} subtitle="Discover restaurants that fit your goals"
    canContinue onContinue={() => router.push('/welcome/location-permission')}
    beforeTitle={<View style={s.hero}>
      <Image source={require('@/assets/dishes/19.jpg')} style={s.photo} accessibilityLabel="Meal inspiration" />
      <Text style={s.caption}>Meal inspiration</Text>
    </View>}
    footerContent={<WelcomeActions label="Find my next meal" onPress={() => router.push('/welcome/location-permission')}
      secondaryLabel="Already have an account? Log in" onSecondary={() => router.push('/auth/login')} secondaryTestID="welcome-login" />}>
    {null}
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  hero: { height: 300, borderRadius: 24, overflow: 'hidden', backgroundColor: EDITORIAL.creamCard, marginBottom: 28 },
  photo: { width: '100%', height: '100%', resizeMode: 'cover' },
  caption: { ...TEXT.bodySmall, position: 'absolute', left: 12, bottom: 12, backgroundColor: EDITORIAL.cream, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
});
