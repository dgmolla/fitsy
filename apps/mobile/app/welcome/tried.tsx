import { requireWelcomeGoal } from '@/lib/requireWelcomeGoal';
import { useOnboardingStep } from '@/lib/onboardingResume';
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { trackOnboardingScreenView, trackOnboardingChoiceSelected } from '@/lib/analytics';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { getOnboardingData, saveOnboardingField } from '@/lib/onboardingStorage';
import { TRIED_OPTIONS, type TriedApproach } from '@/lib/onboardingPersonalization';
import { useRouteContinuation } from '@/lib/useRouteContinuation';

function TriedScreen() {
  useOnboardingStep('tried');
  const { begin } = useRouteContinuation();
  const [selected, setSelected] = useState<TriedApproach | null>(null);
  const [busy, setBusy] = useState(false);
  useFocusEffect(React.useCallback(() => {
    let live = true;
    void getOnboardingData().then(data => { if (live && data.tried) setSelected(data.tried); });
    return () => { live = false; };
  }, []));

  useEffect(() => {
    trackOnboardingScreenView('tried');
  }, []);

  return (
    <WelcomeScreen
      progress={0.22}
      title={"What have you tried\nfor healthy eating?"}
      subtitle="We’ll start with what matters to you."
      onContinue={async () => {
        if (!selected || busy) return;
        const isCurrent = begin();
        setBusy(true);
        try {
          await saveOnboardingField('tried', selected);
          if (!isCurrent()) return;
          trackOnboardingChoiceSelected({ screen: 'tried', value: selected });
          router.push('/welcome/response');
        } catch { if (isCurrent()) Alert.alert('Could not save your answer', 'Please try again.'); }
        finally { if (isCurrent()) setBusy(false); }
      }}
      canContinue={selected !== null && !busy}
    >
      <View style={s.list}>
        {TRIED_OPTIONS.map((opt, i) => {
          const on = selected === opt.id;
          return (
            <Animated.View key={opt.id} entering={FadeInDown.duration(400).delay(100 + i * 60)}>
              <AnimatedPress
                style={[s.row, on ? s.rowOn : undefined]}
                onPress={() => setSelected(opt.id)}
                disabled={busy}
                testID={`tried-${opt.id}`}
                haptic
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={s.icon}>{opt.icon}</Text>
                <Text style={[s.label, on ? s.labelOn : undefined]}>{opt.label}</Text>
              </AnimatedPress>
            </Animated.View>
          );
        })}
      </View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 22,
  },
  rowOn: { backgroundColor: EDITORIAL.green },
  icon: { fontSize: 20 },
  label: { ...TEXT.optionLabel, flex: 1 },
  labelOn: { color: EDITORIAL.cream },
});

export default requireWelcomeGoal(TriedScreen, '/welcome/tried');
