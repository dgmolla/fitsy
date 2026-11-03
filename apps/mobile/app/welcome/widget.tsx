import React from 'react';
import { ImageBackground, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { requireWelcomeGoal } from '@/lib/requireWelcomeGoal';
import { RESUBSCRIBE_SAMPLE, RESUBSCRIBE_SAMPLE_IMAGE } from '@/lib/resubscribeSample';

// This bundled, fixed sample always includes its published dish.
const dish = RESUBSCRIBE_SAMPLE.bestMatch!;
const steps = ['Long-press your Home Screen.', 'Tap + (or Edit → Add Widget).', 'Search fitsy and add the widget.'];

function WidgetCardScreen() {
  // Replace this optional tip so Preview's Back still returns to nutrition context.
  const continueToPreview = () => router.replace('/welcome/preview');
  return <WelcomeScreen progress={0.64} title={"A meal at\na glance."}
    subtitle="Add Fitsy to your Home Screen."
    canContinue onContinue={continueToPreview} onSkip={continueToPreview} continueLabel="Explore restaurants">
    <View style={s.card} testID="onboarding-widget-card">
      {/* Medium MealWidgetView layout, using the existing display-only menu sample. */}
      <ImageBackground source={RESUBSCRIBE_SAMPLE_IMAGE} style={s.example} imageStyle={s.image}
        accessible accessibilityRole="image" testID="onboarding-widget-example"
        accessibilityLabel={`Example Fitsy widget: ${dish.name}, ${dish.proteinG} grams protein, ${dish.carbsG} grams carbs, ${dish.fatG} grams fat, ${dish.calories} calories.`}>
        <LinearGradient colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.76)', 'rgba(0,0,0,0.94)']} style={s.widget}>
          <Text style={s.dish}>{dish.name}</Text>
          <View style={s.macros}>
            <Text style={s.macro}>P {dish.proteinG}g</Text><Text style={s.macro}>C {dish.carbsG}g</Text>
            <Text style={s.macro}>F {dish.fatG}g</Text><Text style={s.macro}>{dish.calories} kcal</Text>
          </View>
        </LinearGradient>
      </ImageBackground>
      <Text style={s.caption}>Example widget · Included with Fitsy Pro</Text>
      <View style={s.steps}>
        {steps.map((step, index) => <Text key={step} style={s.step} testID={`onboarding-widget-step-${index + 1}`}>{index + 1}. {step}</Text>)}
      </View>
    </View>
  </WelcomeScreen>;
}

const s = StyleSheet.create({
  card: { padding: 20, borderRadius: 24, backgroundColor: EDITORIAL.creamCard, gap: 16 },
  example: { height: 158, borderRadius: 22, overflow: 'hidden', backgroundColor: '#121a17' },
  image: { borderRadius: 22 },
  widget: { flex: 1, padding: 14, justifyContent: 'flex-end', gap: 10 },
  dish: { fontFamily: 'Georgia', fontSize: 20, fontWeight: '600', color: '#fff' },
  macros: { flexDirection: 'row', gap: 4 },
  macro: { flex: 1, fontSize: 13, fontWeight: '600', color: '#fff' },
  caption: { ...TEXT.bodySmall, fontSize: 12, textAlign: 'center', color: EDITORIAL.textMid },
  steps: { gap: 14 },
  step: { ...TEXT.body, fontSize: 15, lineHeight: 22 },
});

export default requireWelcomeGoal(WidgetCardScreen, '/welcome/target-setup');
