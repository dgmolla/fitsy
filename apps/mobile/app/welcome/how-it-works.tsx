import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { useTheme } from '@/lib/theme';

export default function HowItWorksScreen() {
  const { colors } = useTheme();

  return (
    <WelcomeScreen
      step={7}
      totalSteps={9}
      title="How we find your meals"
      subtitle="We split your daily targets into 3 equal meals, then match restaurants with items that fit."
      onContinue={() => router.push('/welcome/tuning')}
      canContinue={true}
    >
      <View style={styles.steps}>
        <StepRow
          icon="calculator-outline"
          title="Your daily targets"
          desc="Based on your body stats, we calculated your daily protein, carbs, and fat."
          colors={colors}
        />
        <StepRow
          icon="git-branch-outline"
          title="Split into meals"
          desc="We divide by 3 to get per-meal targets — that's what we search for."
          colors={colors}
        />
        <StepRow
          icon="restaurant-outline"
          title="Match restaurants"
          desc="We find menu items that fit your per-meal macros and rank them by match %."
          colors={colors}
        />
      </View>
    </WelcomeScreen>
  );
}

function StepRow({ icon, title, desc, colors }: {
  icon: string;
  title: string;
  desc: string;
  colors: ReturnType<typeof import('@/lib/theme').useTheme>['colors'];
}) {
  return (
    <View style={styles.stepRow}>
      <View style={[styles.iconWrap, { backgroundColor: colors.accentBg }]}>
        <Ionicons name={icon as never} size={22} color={colors.accent} />
      </View>
      <View style={styles.stepText}>
        <Text style={[styles.stepTitle, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.stepDesc, { color: colors.textSecondary }]}>{desc}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  steps: { gap: 20 },
  stepRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 15, fontWeight: '600' },
  stepDesc: { fontSize: 13, lineHeight: 19 },
});
