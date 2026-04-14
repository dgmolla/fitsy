import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { saveOnboardingField } from '@/lib/onboardingStorage';
import { EDITORIAL, FONTS } from '@/lib/brand';

type Unit = 'lbs' | 'kg';

export default function WeightScreen() {
  const [unit, setUnit] = useState<Unit>('lbs');
  const [value, setValue] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 500);
    return () => clearTimeout(t);
  }, []);

  function toKg(): number {
    const v = parseInt(value, 10);
    if (!v) return 70;
    return unit === 'kg' ? v : Math.round(v * 0.453592 * 10) / 10;
  }

  return (
    <WelcomeScreen
      progress={7 / 13}
      title="What do you weigh?"
      onContinue={async () => {
        await saveOnboardingField('weightKg', toKg());
        router.push('/welcome/age');
      }}
      canContinue={true}
      onSkip={() => router.push('/welcome/age')}
    >
      <Animated.View entering={FadeInDown.duration(400).delay(100)} style={s.wrap}>
        {/* Unit toggle */}
        <View style={s.toggle}>
          <AnimatedPress style={[s.toggleBtn, unit === 'lbs' && s.toggleOn]} onPress={() => setUnit('lbs')} haptic>
            <Text style={[s.toggleTxt, unit === 'lbs' && s.toggleTxtOn]}>lbs</Text>
          </AnimatedPress>
          <AnimatedPress style={[s.toggleBtn, unit === 'kg' && s.toggleOn]} onPress={() => setUnit('kg')} haptic>
            <Text style={[s.toggleTxt, unit === 'kg' && s.toggleTxtOn]}>kg</Text>
          </AnimatedPress>
        </View>

        <View>
          <Text style={s.label}>WEIGHT</Text>
          <View style={s.inputRow}>
            <TextInput
              ref={inputRef}
              style={s.input}
              value={value}
              onChangeText={setValue}
              keyboardType="number-pad"
              maxLength={3}
              placeholder={unit === 'lbs' ? '155' : '70'}
              placeholderTextColor={EDITORIAL.creamDeep}
            />
            <Text style={s.unit}>{unit}</Text>
          </View>
        </View>
      </Animated.View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 24 },
  toggle: { flexDirection: 'row', backgroundColor: EDITORIAL.creamCard, borderRadius: 14, padding: 4 },
  toggleBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  toggleOn: { backgroundColor: EDITORIAL.green },
  toggleTxt: { fontSize: 14, fontWeight: '600', color: EDITORIAL.textSoft },
  toggleTxtOn: { color: EDITORIAL.cream },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: EDITORIAL.textSoft, textTransform: 'uppercase' },
  inputRow: {
    flexDirection: 'row', alignItems: 'baseline',
    backgroundColor: EDITORIAL.creamCard, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 20,
  },
  input: { flex: 1, fontFamily: FONTS.newsreaderBold, fontSize: 36, color: EDITORIAL.text, letterSpacing: -1, padding: 0 },
  unit: { fontSize: 18, color: EDITORIAL.textSoft, fontWeight: '500' },
});
