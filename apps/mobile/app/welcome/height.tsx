import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { saveOnboardingField } from '@/lib/onboardingStorage';
import { EDITORIAL, FONTS } from '@/lib/brand';

type Unit = 'ft' | 'cm';

export default function HeightScreen() {
  const [unit, setUnit] = useState<Unit>('ft');
  const [ft, setFt] = useState('');
  const [inches, setInches] = useState('');
  const [cm, setCm] = useState('');

  function toCm(): number {
    if (unit === 'cm') return parseInt(cm, 10) || 170;
    const f = parseInt(ft, 10) || 5;
    const i = parseInt(inches, 10) || 9;
    return Math.round(f * 30.48 + i * 2.54);
  }

  return (
    <WelcomeScreen
      step={4}
      totalSteps={8}
      title="How tall are you?"
      onContinue={async () => {
        await saveOnboardingField('heightCm', toCm());
        router.push('/welcome/weight');
      }}
      canContinue={true}
      onSkip={() => router.push('/welcome/weight')}
    >
      <Animated.View entering={FadeInDown.duration(400).delay(100)} style={s.wrap}>
        {/* Unit toggle */}
        <View style={s.toggle}>
          <AnimatedPress style={[s.toggleBtn, unit === 'ft' && s.toggleOn]} onPress={() => setUnit('ft')} haptic>
            <Text style={[s.toggleTxt, unit === 'ft' && s.toggleTxtOn]}>ft / in</Text>
          </AnimatedPress>
          <AnimatedPress style={[s.toggleBtn, unit === 'cm' && s.toggleOn]} onPress={() => setUnit('cm')} haptic>
            <Text style={[s.toggleTxt, unit === 'cm' && s.toggleTxtOn]}>cm</Text>
          </AnimatedPress>
        </View>

        {unit === 'ft' ? (
          <View style={s.ftRow}>
            <View style={s.ftField}>
              <Text style={s.label}>FEET</Text>
              <View style={s.inputRow}>
                <TextInput
                  style={s.input}
                  value={ft}
                  onChangeText={setFt}
                  keyboardType="number-pad"
                  maxLength={1}
                  placeholder="5"
                  placeholderTextColor={EDITORIAL.creamDeep}
                  autoFocus
                />
                <Text style={s.unit}>ft</Text>
              </View>
            </View>
            <View style={s.ftField}>
              <Text style={s.label}>INCHES</Text>
              <View style={s.inputRow}>
                <TextInput
                  style={s.input}
                  value={inches}
                  onChangeText={setInches}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="9"
                  placeholderTextColor={EDITORIAL.creamDeep}
                />
                <Text style={s.unit}>in</Text>
              </View>
            </View>
          </View>
        ) : (
          <View>
            <Text style={s.label}>HEIGHT</Text>
            <View style={s.inputRow}>
              <TextInput
                style={s.input}
                value={cm}
                onChangeText={setCm}
                keyboardType="number-pad"
                maxLength={3}
                placeholder="170"
                placeholderTextColor={EDITORIAL.creamDeep}
                autoFocus
              />
              <Text style={s.unit}>cm</Text>
            </View>
          </View>
        )}
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
  ftRow: { flexDirection: 'row', gap: 16 },
  ftField: { flex: 1, gap: 10 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: EDITORIAL.textSoft, textTransform: 'uppercase' },
  inputRow: {
    flexDirection: 'row', alignItems: 'baseline',
    backgroundColor: EDITORIAL.creamCard, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 20,
  },
  input: { flex: 1, fontFamily: FONTS.newsreaderBold, fontSize: 36, color: EDITORIAL.text, letterSpacing: -1, padding: 0 },
  unit: { fontSize: 18, color: EDITORIAL.textSoft, fontWeight: '500' },
});
