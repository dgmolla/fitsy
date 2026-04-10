import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { getOnboardingData, calculateSuggestedCalories, type Goal } from '@/lib/onboardingStorage';
import { saveMacroTargets } from '@/lib/macroStorage';

interface Macros { protein: number; carbs: number; fat: number; calories: number }

function calcMacros(data: Awaited<ReturnType<typeof getOnboardingData>>, goalOverride?: Goal): Macros {
  const cal = calculateSuggestedCalories(goalOverride ? { ...data, goal: goalOverride } : data);
  const goal = goalOverride ?? data.goal ?? 'maintain';
  const pPct = goal === 'build_muscle' ? 0.35 : goal === 'lose_fat' ? 0.40 : 0.30;
  const fPct = 0.25;
  return {
    protein: Math.round((cal * pPct) / 4),
    carbs: Math.round((cal * (1 - pPct - fPct)) / 4),
    fat: Math.round((cal * fPct) / 9),
    calories: Math.round(cal),
  };
}

type Traj = 'lose_fat' | 'maintain' | 'build_muscle';

export default function PlanReadyScreen() {
  const [macros, setMacros] = useState<Macros | null>(null);
  const [traj, setTraj] = useState<Traj>('maintain');
  const [data, setData] = useState<Awaited<ReturnType<typeof getOnboardingData>>>({});

  useEffect(() => {
    (async () => {
      const d = await getOnboardingData();
      setData(d);
      const g = (d.goal ?? 'maintain') as Traj;
      setTraj(g);
      const m = calcMacros(d);
      setMacros(m);
      await saveMacroTargets({ protein: String(m.protein), carbs: String(m.carbs), fat: String(m.fat), calories: String(m.calories) });
    })();
  }, []);

  async function pick(t: Traj) {
    setTraj(t);
    const m = calcMacros(data, t);
    setMacros(m);
    await saveMacroTargets({ protein: String(m.protein), carbs: String(m.carbs), fat: String(m.fat), calories: String(m.calories) });
  }

  return (
    <WelcomeScreen
      step={7}
      totalSteps={7}
      title="Your plan."
      onContinue={() => router.push('/welcome/preview')}
      canContinue={macros !== null}
      continueLabel="See Restaurants"
    >
      {macros && (
        <>
          {/* Hero food image strip */}
          <Animated.View entering={FadeIn.duration(600).delay(100)} style={s.imgStrip}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=75' }}
              style={s.heroImg}
              resizeMode="cover"
            />
          </Animated.View>

          {/* Macro grid */}
          <View style={s.grid}>
            <MacroNum label="Protein" value={macros.protein} unit="g" delay={200} accent />
            <MacroNum label="Carbs" value={macros.carbs} unit="g" delay={260} />
            <MacroNum label="Fat" value={macros.fat} unit="g" delay={320} />
            <MacroNum label="Calories" value={macros.calories} unit="" delay={380} accent />
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
    marginBottom: 32,
  },
  heroImg: { width: '100%', height: 160, borderRadius: 20 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 28,
    marginBottom: 40,
  },
  macroCell: { width: '50%', gap: 4 },
  macroLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: EDITORIAL.textSoft,
    textTransform: 'uppercase',
  },
  macroValue: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 44,
    color: EDITORIAL.text,
    letterSpacing: -2,
  },
  macroUnit: { fontSize: 20, color: EDITORIAL.textSoft, letterSpacing: 0 },

  trajWrap: { gap: 14 },
  trajLabel: {
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
  trajBtn: { flex: 1, alignItems: 'center', paddingVertical: 16, borderRadius: 14 },
  trajOn: { backgroundColor: EDITORIAL.green },
  trajTxt: { fontSize: 15, fontWeight: '600', color: EDITORIAL.textSoft },
  trajTxtOn: { color: EDITORIAL.cream },
});
