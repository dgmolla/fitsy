import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { getOnboardingData, calculateSuggestedCalories } from '@/lib/onboardingStorage';
import { saveMacroTargets } from '@/lib/macroStorage';

interface Macros { protein: number; carbs: number; fat: number; calories: number }

function calcMacros(data: ReturnType<typeof getOnboardingData> extends Promise<infer T> ? T : never): Macros {
  const calories = calculateSuggestedCalories(data);
  const goal = data.goal ?? 'maintain';
  // Simple macro split based on goal
  const proteinPct = goal === 'build_muscle' ? 0.35 : goal === 'lose_fat' ? 0.40 : 0.30;
  const fatPct = 0.25;
  const carbPct = 1 - proteinPct - fatPct;
  return {
    protein: Math.round((calories * proteinPct) / 4),
    carbs: Math.round((calories * carbPct) / 4),
    fat: Math.round((calories * fatPct) / 9),
    calories: Math.round(calories),
  };
}

export default function TargetsRevealScreen() {
  const [macros, setMacros] = useState<Macros | null>(null);

  useEffect(() => {
    (async () => {
      const data = await getOnboardingData();
      const m = calcMacros(data);
      setMacros(m);
      await saveMacroTargets({
        protein: String(m.protein),
        carbs: String(m.carbs),
        fat: String(m.fat),
        calories: String(m.calories),
      });
    })();
  }, []);

  return (
    <WelcomeScreen
      step={6}
      totalSteps={8}
      title="Here's what we recommend."
      subtitle="Your personalized per-meal targets. Adjust anytime in the app."
      onContinue={() => router.push('/welcome/preview')}
      canContinue={macros !== null}
    >
      {macros ? (
        <View style={styles.reveal}>
          <View style={styles.macroStrip}>
            <MacroCell label="PROTEIN" value={`${macros.protein}g`} />
            <View style={styles.divider} />
            <MacroCell label="CARBS" value={`${macros.carbs}g`} />
            <View style={styles.divider} />
            <MacroCell label="FAT" value={`${macros.fat}g`} />
          </View>
          <View style={styles.calRow}>
            <Text style={styles.calValue}>{macros.calories}</Text>
            <Text style={styles.calLabel}>kcal per meal</Text>
          </View>
        </View>
      ) : (
        <View style={styles.reveal}>
          <Text style={{ color: EDITORIAL.textSoft }}>Calculating...</Text>
        </View>
      )}
    </WelcomeScreen>
  );
}

function MacroCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.macroCell}>
      <Text style={styles.macroValue}>{value}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  reveal: { alignItems: 'center', gap: 20, marginTop: 20 },
  macroStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    paddingVertical: 20,
    paddingHorizontal: 16,
    width: '100%',
  },
  macroCell: { flex: 1, alignItems: 'center', gap: 4 },
  macroValue: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 28,
    color: EDITORIAL.text,
    letterSpacing: -0.5,
  },
  macroLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: EDITORIAL.textSoft,
    letterSpacing: 1.5,
  },
  divider: { width: 1, height: 36, backgroundColor: EDITORIAL.border },
  calRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  calValue: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 48,
    color: EDITORIAL.green,
    letterSpacing: -1,
  },
  calLabel: {
    fontSize: 16,
    color: EDITORIAL.textSoft,
    fontWeight: '500',
  },
});
