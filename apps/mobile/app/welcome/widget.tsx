import React from 'react';
import { Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { TEXT } from '@/lib/brand';
import { requireWelcomeGoal } from '@/lib/requireWelcomeGoal';
import { openPurchasedDestination } from '@/lib/paywallJourney';
import { clearPaymentSignInContinuation } from '@/lib/paymentSignInContinuation';

const steps = ['Long-press your Home Screen.', 'Tap + (or Edit → Add Widget).', 'Search fitsy and add the widget.'];

function WidgetCardScreen() {
  const navigation = useNavigation();
  // Match WelcomeScreen's own compact breakpoint so the phone shrinks on
  // shorter devices (iPhone SE) rather than pushing the steps under the footer.
  const { height, fontScale } = useWindowDimensions();
  const compact = height < 780 && fontScale <= 1.2;
  const phoneWidth = compact ? 108 : 140;
  // This is the last onboarding screen; finish exactly as a direct purchase
  // without a widget tip already does.
  const finish = () => { void openPurchasedDestination(navigation).then(() => clearPaymentSignInContinuation()); };
  return <WelcomeScreen progress={0.95} title={"A meal at\na glance."}
    subtitle="Add Fitsy to your Home Screen to see it like this."
    canContinue onContinue={finish} onSkip={finish} continueLabel="Start exploring" showBack={false}>
    <View style={[s.phone, { width: phoneWidth, marginBottom: compact ? 12 : 20 }]} testID="onboarding-widget-card">
      <Image source={require('../../assets/widget-homescreen.png')} resizeMode="contain" style={s.screenshot}
        accessible accessibilityRole="image" testID="onboarding-widget-example"
        accessibilityLabel="Example Fitsy widget on a Home Screen, showing a real meal with its protein, carbs, fat and calories." />
    </View>
    <View style={[s.steps, compact && s.stepsCompact]}>
      {steps.map((step, index) => <Text key={step} style={[s.step, compact && s.stepCompact]} testID={`onboarding-widget-step-${index + 1}`}>{index + 1}. {step}</Text>)}
    </View>
  </WelcomeScreen>;
}

const s = StyleSheet.create({
  phone: { alignSelf: 'center', aspectRatio: 9 / 18.5, borderRadius: 26, overflow: 'hidden', backgroundColor: '#1C1C1E' },
  screenshot: { width: '100%', height: '100%' },
  steps: { gap: 10 },
  stepsCompact: { gap: 6 },
  step: { ...TEXT.body, fontSize: 15, lineHeight: 22 },
  stepCompact: { fontSize: 13, lineHeight: 18 },
});

export default requireWelcomeGoal(WidgetCardScreen, '/welcome/target-setup');
