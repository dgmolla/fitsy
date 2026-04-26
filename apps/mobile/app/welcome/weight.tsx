import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { StatPicker } from '@/components/StatPicker';
import { getOnboardingData, saveOnboardingField } from '@/lib/onboardingStorage';
import { EDITORIAL, FONTS } from '@/lib/brand';

type Unit = 'lbs' | 'kg';

const LB_MIN = 80;
const LB_MAX = 400;
const LB_DEFAULT = 170;
const KG_MIN = 36;
const KG_MAX = 180;
const KG_DEFAULT = 77;

export default function WeightScreen() {
  const [unit, setUnit] = useState<Unit>('lbs');
  const [lbs, setLbs] = useState(LB_DEFAULT);
  const [kg, setKg] = useState(KG_DEFAULT);

  useEffect(() => {
    (async () => {
      const data = await getOnboardingData();
      if (data.weightKg) {
        const k = Math.round(data.weightKg);
        setKg(Math.max(KG_MIN, Math.min(KG_MAX, k)));
        const l = Math.round(data.weightKg * 2.20462);
        setLbs(Math.max(LB_MIN, Math.min(LB_MAX, l)));
      }
    })();
  }, []);

  function toKg(): number {
    return unit === 'kg' ? kg : Math.round(lbs * 0.453592 * 10) / 10;
  }

  return (
    <WelcomeScreen
      progress={9 / 15}
      title="What do you weigh?"
      subtitle="Roughly is fine. We'll fine-tune later."
      onContinue={async () => {
        await saveOnboardingField('weightKg', toKg());
        router.push('/welcome/age');
      }}
      canContinue={true}
      onSkip={() => router.push('/welcome/age')}
    >
      <Animated.View entering={FadeInDown.duration(400).delay(100)} style={s.wrap}>
        <View style={s.toggle}>
          <AnimatedPress style={[s.toggleBtn, unit === 'lbs' && s.toggleOn]} onPress={() => setUnit('lbs')} haptic>
            <Text style={[s.toggleTxt, unit === 'lbs' && s.toggleTxtOn]}>lbs</Text>
          </AnimatedPress>
          <AnimatedPress style={[s.toggleBtn, unit === 'kg' && s.toggleOn]} onPress={() => setUnit('kg')} haptic>
            <Text style={[s.toggleTxt, unit === 'kg' && s.toggleTxtOn]}>kg</Text>
          </AnimatedPress>
        </View>

        <View style={s.stage}>
          {unit === 'lbs' ? (
            <StatPicker min={LB_MIN} max={LB_MAX} value={lbs} onChange={setLbs} />
          ) : (
            <StatPicker min={KG_MIN} max={KG_MAX} value={kg} onChange={setKg} />
          )}
          <View style={s.valueBox}>
            <Text style={s.valueLabel}>WEIGHT</Text>
            <Text style={s.valueNum}>
              {unit === 'lbs' ? lbs : kg}
              <Text style={s.valueUnit}> {unit}</Text>
            </Text>
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

  stage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 8,
  },
  valueBox: { flex: 1 },
  valueLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: EDITORIAL.textSoft,
    marginBottom: 8,
  },
  valueNum: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 56,
    color: EDITORIAL.text,
    letterSpacing: -2.5,
    lineHeight: 60,
  },
  valueUnit: {
    fontFamily: FONTS.newsreaderRegular,
    fontSize: 22,
    color: EDITORIAL.textSoft,
    letterSpacing: 0,
  },
});
