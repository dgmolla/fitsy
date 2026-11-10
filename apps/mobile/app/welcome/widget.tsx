import React from 'react';
import { ImageBackground, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { requireWelcomeGoal } from '@/lib/requireWelcomeGoal';
import { RESUBSCRIBE_SAMPLE, RESUBSCRIBE_SAMPLE_IMAGE } from '@/lib/resubscribeSample';
import { openPurchasedDestination } from '@/lib/paywallJourney';
import { clearPaymentSignInContinuation } from '@/lib/paymentSignInContinuation';

// This bundled, fixed sample always includes its published dish.
const dish = RESUBSCRIBE_SAMPLE.bestMatch!;
const steps = ['Long-press your Home Screen.', 'Tap + (or Edit → Add Widget).', 'Search fitsy and add the widget.'];
const DOCK_ICONS = 4;
const GRID_ICONS = 8;

function HomeScreenIcon({ testID }: { testID?: string }) {
  return <View style={s.icon} testID={testID} />;
}

function WidgetCardScreen() {
  const navigation = useNavigation();
  // This is the last onboarding screen; finish exactly as a direct purchase
  // without a widget tip already does.
  const finish = () => { void openPurchasedDestination(navigation).then(() => clearPaymentSignInContinuation()); };
  return <WelcomeScreen progress={0.95} title={"A meal at\na glance."}
    subtitle="Add Fitsy to your Home Screen to see it like this."
    canContinue onContinue={finish} onSkip={finish} continueLabel="Start exploring">
    <View style={s.phone} testID="onboarding-widget-card">
      <View style={s.notch} />
      <View style={s.screen}>
        <Text style={s.clock}>9:41</Text>
        <View style={s.grid}>
          {Array.from({ length: GRID_ICONS }, (_, index) => <HomeScreenIcon key={index} />)}
        </View>
        <ImageBackground source={RESUBSCRIBE_SAMPLE_IMAGE} style={s.widget} imageStyle={s.widgetImage}
          accessible accessibilityRole="image" testID="onboarding-widget-example"
          accessibilityLabel={`Example Fitsy widget on a Home Screen: ${dish.name}, ${dish.proteinG} grams protein, ${dish.carbsG} grams carbs, ${dish.fatG} grams fat, ${dish.calories} calories.`}>
          <LinearGradient colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.76)', 'rgba(0,0,0,0.94)']} style={s.widgetOverlay}>
            <Text style={s.dish}>{dish.name}</Text>
            <View style={s.macros}>
              <Text style={s.macro}>P {dish.proteinG}g</Text><Text style={s.macro}>C {dish.carbsG}g</Text>
              <Text style={s.macro}>F {dish.fatG}g</Text><Text style={s.macro}>{dish.calories} kcal</Text>
            </View>
          </LinearGradient>
        </ImageBackground>
        <View style={s.dock}>
          {Array.from({ length: DOCK_ICONS }, (_, index) => <HomeScreenIcon key={index} />)}
        </View>
      </View>
    </View>
    <Text style={s.caption}>Example widget · Included with Fitsy Pro</Text>
    <View style={s.steps}>
      {steps.map((step, index) => <Text key={step} style={s.step} testID={`onboarding-widget-step-${index + 1}`}>{index + 1}. {step}</Text>)}
    </View>
  </WelcomeScreen>;
}

const BEZEL = '#1C1C1E';
const s = StyleSheet.create({
  phone: { alignSelf: 'center', width: 220, aspectRatio: 9 / 18.5, backgroundColor: BEZEL, borderRadius: 36, borderWidth: 8, borderColor: BEZEL, padding: 6, marginBottom: 16 },
  notch: { position: 'absolute', top: 6, left: '50%', marginLeft: -36, width: 72, height: 18, backgroundColor: BEZEL, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, zIndex: 1 },
  screen: { flex: 1, borderRadius: 28, backgroundColor: EDITORIAL.greenMid, overflow: 'hidden', padding: 10, gap: 10 },
  clock: { color: '#fff', fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  icon: { width: 22, height: 22, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.28)' },
  widget: { height: 72, borderRadius: 14, overflow: 'hidden', backgroundColor: '#121a17' },
  widgetImage: { borderRadius: 14 },
  widgetOverlay: { flex: 1, padding: 8, justifyContent: 'flex-end', gap: 4 },
  dish: { fontFamily: 'Georgia', fontSize: 11, fontWeight: '600', color: '#fff' },
  macros: { flexDirection: 'row', gap: 3 },
  macro: { flex: 1, fontSize: 8, fontWeight: '600', color: '#fff' },
  dock: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4 },
  caption: { ...TEXT.bodySmall, fontSize: 12, textAlign: 'center', color: EDITORIAL.textMid, marginBottom: 16 },
  steps: { gap: 14 },
  step: { ...TEXT.body, fontSize: 15, lineHeight: 22 },
});

export default requireWelcomeGoal(WidgetCardScreen, '/welcome/target-setup');
