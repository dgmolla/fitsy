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
  const phoneWidth = compact ? 100 : 130;
  const bezel = compact ? 4 : 5;
  const outerRadius = compact ? 22 : 28;
  // This is the last onboarding screen; finish exactly as a direct purchase
  // without a widget tip already does.
  const finish = () => { void openPurchasedDestination(navigation).then(() => clearPaymentSignInContinuation()); };
  return <WelcomeScreen progress={0.95} title={"A meal at\na glance."}
    subtitle="Add Fitsy to your Home Screen to see it like this."
    canContinue onContinue={finish} onSkip={finish} continueLabel="Start exploring" showBack={false}>
    {/* Matches fitsy.org's hero phone: a plain dark bezel (padding = frame
      * thickness) around a clipped, cover-fit screenshot - no drawn phone
      * mockup to keep in proportion, so the real screenshot always fills
      * the frame edge to edge with no gaps or cropped content. */}
    <View style={[s.phone, { width: phoneWidth, aspectRatio: 9 / 19.5, borderRadius: outerRadius, padding: bezel, marginBottom: compact ? 12 : 20 }]} testID="onboarding-widget-card">
      <View style={[s.notch, { top: bezel + 4 }]} />
      <View style={[s.screen, { borderRadius: outerRadius - bezel }]}>
        <Image source={require('../../assets/widget-homescreen.png')} resizeMode="cover" style={s.screenshot}
          accessible accessibilityRole="image" testID="onboarding-widget-example"
          accessibilityLabel="Example Fitsy widget on a Home Screen, showing a real meal with its protein, carbs, fat and calories." />
      </View>
    </View>
    <View style={[s.steps, compact && s.stepsCompact]}>
      {steps.map((step, index) => <Text key={step} style={[s.step, compact && s.stepCompact]} testID={`onboarding-widget-step-${index + 1}`}>{index + 1}. {step}</Text>)}
    </View>
  </WelcomeScreen>;
}

const s = StyleSheet.create({
  phone: { alignSelf: 'center', backgroundColor: '#1a1a1a' },
  screen: { flex: 1, overflow: 'hidden' },
  screenshot: { width: '100%', height: '100%' },
  notch: { position: 'absolute', left: '50%', marginLeft: -16, width: 32, height: 8, borderRadius: 4, backgroundColor: '#000', zIndex: 1 },
  steps: { gap: 10 },
  stepsCompact: { gap: 6 },
  step: { ...TEXT.body, fontSize: 15, lineHeight: 22 },
  stepCompact: { fontSize: 13, lineHeight: 18 },
});

export default requireWelcomeGoal(WidgetCardScreen, '/welcome/target-setup');
