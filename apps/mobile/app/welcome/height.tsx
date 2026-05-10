import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { StatPicker } from '@/components/StatPicker';
import { getOnboardingData, saveOnboardingField } from '@/lib/onboardingStorage';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { EDITORIAL, FONTS } from '@/lib/brand';

type Unit = 'ft' | 'cm';

const FT_MIN_IN = 48;  // 4'0"
const FT_MAX_IN = 84;  // 7'0"
const FT_DEFAULT_IN = 69; // 5'9"
const CM_MIN = 122;
const CM_MAX = 213;
const CM_DEFAULT = 175;

function fmtFtIn(totalInches: number): string {
  const ft = Math.floor(totalInches / 12);
  const inch = totalInches % 12;
  return `${ft}'${inch}"`;
}

export default function HeightScreen() {
  const [unit, setUnit] = useState<Unit>('ft');
  const [inches, setInches] = useState(FT_DEFAULT_IN);
  const [cm, setCm] = useState(CM_DEFAULT);

  useEffect(() => {
    trackOnboardingScreenView('height');
  }, []);

  useEffect(() => {
    (async () => {
      const data = await getOnboardingData();
      if (data.heightCm) {
        setCm(Math.max(CM_MIN, Math.min(CM_MAX, data.heightCm)));
        const totalInches = Math.round(data.heightCm / 2.54);
        setInches(Math.max(FT_MIN_IN, Math.min(FT_MAX_IN, totalInches)));
      }
    })();
  }, []);

  function toCm(): number {
    return unit === 'cm' ? cm : Math.round(inches * 2.54);
  }

  return (
    <WelcomeScreen
      progress={8 / 15}
      title="How tall are you?"
      subtitle="Scroll to your height."
      onContinue={async () => {
        await saveOnboardingField('heightCm', toCm());
        router.push('/welcome/weight');
      }}
      canContinue={true}
      onSkip={() => router.push('/welcome/weight')}
    >
      <Animated.View entering={FadeInDown.duration(400).delay(100)} style={s.wrap}>
        <View style={s.toggle}>
          <AnimatedPress style={[s.toggleBtn, unit === 'ft' && s.toggleOn]} onPress={() => setUnit('ft')} haptic>
            <Text style={[s.toggleTxt, unit === 'ft' && s.toggleTxtOn]}>ft / in</Text>
          </AnimatedPress>
          <AnimatedPress style={[s.toggleBtn, unit === 'cm' && s.toggleOn]} onPress={() => setUnit('cm')} haptic>
            <Text style={[s.toggleTxt, unit === 'cm' && s.toggleTxtOn]}>cm</Text>
          </AnimatedPress>
        </View>

        <View style={s.stage}>
          {unit === 'ft' ? (
            <StatPicker
              min={FT_MIN_IN}
              max={FT_MAX_IN}
              value={inches}
              onChange={setInches}
              formatter={fmtFtIn}
            />
          ) : (
            <StatPicker
              min={CM_MIN}
              max={CM_MAX}
              value={cm}
              onChange={setCm}
            />
          )}
          <View style={s.valueBox}>
            <Text style={s.valueLabel}>HEIGHT</Text>
            {unit === 'ft' ? (
              <Text style={s.valueNum}>{fmtFtIn(inches)}</Text>
            ) : (
              <Text style={s.valueNum}>
                {cm}
                <Text style={s.valueUnit}> cm</Text>
              </Text>
            )}
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
    fontFamily: FONTS.frauncesBold,
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
