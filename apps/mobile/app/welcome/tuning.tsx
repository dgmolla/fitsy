import React, { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { getOnboardingData, type Goal } from '@/lib/onboardingStorage';
import { saveMacroTargets } from '@/lib/macroStorage';
import { calculateMacros, MEALS_PER_DAY } from '@/lib/macroCalculator';
import { trackOnboardingScreenView } from '@/lib/analytics';

interface Macros { protein: number; carbs: number; fat: number; calories: number }

function calcMacros(data: Awaited<ReturnType<typeof getOnboardingData>>, goalOverride?: Goal): Macros {
  return calculateMacros(goalOverride ? { ...data, goal: goalOverride } : data);
}

type Traj = 'lose_fat' | 'maintain' | 'build_muscle';

export default function PlanReadyScreen() {
  const [macros, setMacros] = useState<Macros | null>(null);
  const [traj, setTraj] = useState<Traj>('maintain');
  const [data, setData] = useState<Awaited<ReturnType<typeof getOnboardingData>>>({});

  useEffect(() => {
    trackOnboardingScreenView('tuning');
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const d = await getOnboardingData();
        setData(d);
        const g = (d.goal ?? 'maintain') as Traj;
        setTraj(g);
        const m = calcMacros(d);
        setMacros(m);
        await saveMacroTargets({ protein: String(m.protein), carbs: String(m.carbs), fat: String(m.fat), calories: String(m.calories) });
      })();
    }, []),
  );

  async function pick(t: Traj) {
    setTraj(t);
    const m = calcMacros(data, t);
    setMacros(m);
    await saveMacroTargets({ protein: String(m.protein), carbs: String(m.carbs), fat: String(m.fat), calories: String(m.calories) });
  }

  return (
    <WelcomeScreen
      progress={16 / 18}
      title="Your daily targets."
      subtitle="We've set per-meal targets based on your goals. You can adjust them anytime in search."
      onContinue={() => router.push('/welcome/location-permission')}
      canContinue={macros !== null}
      continueLabel="See Restaurants"
    >
      {macros && (
        <>
          {/* Hero food image strip */}
          <Animated.View entering={FadeIn.duration(600).delay(100)} style={s.imgStrip}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600&q=75' }}
              style={s.heroImg}
              resizeMode="cover"
            />
          </Animated.View>

          {/* Macro grid — display daily values (stored per-meal × MEALS_PER_DAY) */}
          <View style={s.grid}>
            <MacroNum label="Protein" value={macros.protein * MEALS_PER_DAY} unit="g" delay={200} accent />
            <MacroNum label="Carbs" value={macros.carbs * MEALS_PER_DAY} unit="g" delay={260} />
            <MacroNum label="Fat" value={macros.fat * MEALS_PER_DAY} unit="g" delay={320} />
            <MacroNum label="Calories" value={macros.calories * MEALS_PER_DAY} unit="" delay={380} accent />
          </View>

          {/* Trajectory */}
          <Animated.View entering={FadeInDown.duration(400).delay(450)} style={s.trajWrap}>
            <Text style={s.trajLabel}>Trajectory</Text>
            <View style={s.trajRow}>
              {([
                ['lose_fat', 'Cut'],
                ['maintain', 'Maintain'],
                ['build_muscle', 'Bulk'],
              ] as [Traj, string][]).map(([id, label]) => (
                <AnimatedPress
                  key={id}
                  style={[s.trajBtn, traj === id ? s.trajOn : undefined]}
                  onPress={() => pick(id)}
                  haptic
                >
                  <Text style={[s.trajTxt, traj === id ? s.trajTxtOn : undefined]}>{label}</Text>
                </AnimatedPress>
              ))}
            </View>
          </Animated.View>
        </>
      )}
    </WelcomeScreen>
  );
}

function MacroNum({ label, value, unit, delay, accent }: { label: string; value: number; unit: string; delay: number; accent?: boolean }) {
  return (
    <Animated.View entering={FadeInDown.duration(400).delay(delay)} style={s.macroCell}>
      <Text style={[s.macroLabel, accent && { color: EDITORIAL.greenAccent }]}>{label}</Text>
      <Text style={s.macroValue}>
        {value.toLocaleString()}
        {unit ? <Text style={s.macroUnit}>{unit}</Text> : null}
      </Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  imgStrip: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 20,
  },
  heroImg: { width: '100%', height: 110, borderRadius: 20 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 16,
    marginBottom: 20,
  },
  macroCell: { width: '50%', gap: 2 },
  macroLabel: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: EDITORIAL.textSoft,
    textTransform: 'uppercase',
  },
  macroValue: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 36,
    color: EDITORIAL.green,
    letterSpacing: -1.5,
  },
  macroUnit: { fontFamily: FONTS.nunitoSans, fontSize: 20, color: EDITORIAL.textSoft, letterSpacing: 0 },

  trajWrap: { gap: 14 },
  trajLabel: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: EDITORIAL.textSoft,
    textTransform: 'uppercase',
  },
  trajRow: {
    flexDirection: 'row',
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 16,
    padding: 4,
  },
  trajBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14 },
  trajOn: { backgroundColor: EDITORIAL.green },
  trajTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 15, fontWeight: '600', color: EDITORIAL.textSoft },
  trajTxtOn: { color: EDITORIAL.cream },
});
