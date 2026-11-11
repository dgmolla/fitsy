import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { TEXT } from '@/lib/brand';
import { requireWelcomeGoal } from '@/lib/requireWelcomeGoal';
import { openPurchasedDestination } from '@/lib/paywallJourney';
import { clearPaymentSignInContinuation } from '@/lib/paymentSignInContinuation';

const steps = ['Long-press your Home Screen.', 'Tap + (or Edit → Add Widget).', 'Search fitsy and add the widget.'];

function WidgetCardScreen() {
  const navigation = useNavigation();
  // This is the last onboarding screen; finish exactly as a direct purchase
  // without a widget tip already does.
  const finish = () => { void openPurchasedDestination(navigation).then(() => clearPaymentSignInContinuation()); };
  return <WelcomeScreen progress={0.95} title={"A meal at\na glance."}
    subtitle="Add Fitsy to your Home Screen to see it like this."
    canContinue onContinue={finish} onSkip={finish} continueLabel="Start exploring">
    <View style={s.phone} testID="onboarding-widget-card">
      <Image source={require('../../assets/widget-homescreen.png')} resizeMode="contain" style={s.screenshot}
        accessible accessibilityRole="image" testID="onboarding-widget-example"
        accessibilityLabel="Example Fitsy widget on a Home Screen, showing a real meal with its protein, carbs, fat and calories." />
    </View>
    <View style={s.steps}>
      {steps.map((step, index) => <Text key={step} style={s.step} testID={`onboarding-widget-step-${index + 1}`}>{index + 1}. {step}</Text>)}
    </View>
  </WelcomeScreen>;
}

const s = StyleSheet.create({
  phone: { alignSelf: 'center', width: 140, aspectRatio: 9 / 18.5, borderRadius: 26, overflow: 'hidden', backgroundColor: '#1C1C1E', marginBottom: 20 },
  screenshot: { width: '100%', height: '100%' },
  steps: { gap: 10 },
  step: { ...TEXT.body, fontSize: 15, lineHeight: 22 },
});

export default requireWelcomeGoal(WidgetCardScreen, '/welcome/target-setup');
