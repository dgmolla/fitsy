import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { StatPicker } from '@/components/StatPicker';
import { getOnboardingData, saveOnboardingField } from '@/lib/onboardingStorage';
import { calculateAge } from '@fitsy/shared';
import { EDITORIAL, FONTS } from '@/lib/brand';

const AGE_MIN = 16;
const AGE_MAX = 80;
const AGE_DEFAULT = 28;

export default function AgeScreen() {
  const [age, setAge] = useState(AGE_DEFAULT);

  useEffect(() => {
    (async () => {
      const data = await getOnboardingData();
      if (data.birthday) {
        const a = calculateAge(data.birthday);
        if (a) setAge(Math.max(AGE_MIN, Math.min(AGE_MAX, a)));
      }
    })();
  }, []);

  return (
    <WelcomeScreen
      progress={10 / 15}
      title="How old are you?"
      subtitle="Used to set your baseline metabolic rate."
      onContinue={async () => {
        await saveOnboardingField('birthday', `${new Date().getFullYear() - age}-01-01`);
        router.push('/welcome/activity');
      }}
      canContinue={true}
      onSkip={() => router.push('/welcome/activity')}
    >
      <Animated.View entering={FadeInDown.duration(400).delay(100)} style={s.wrap}>
        <View style={s.stage}>
          <StatPicker min={AGE_MIN} max={AGE_MAX} value={age} onChange={setAge} />
          <View style={s.valueBox}>
            <Text style={s.valueLabel}>AGE</Text>
            <Text style={s.valueNum}>
              {age}
              <Text style={s.valueUnit}> yrs</Text>
            </Text>
          </View>
        </View>
      </Animated.View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 24 },
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
