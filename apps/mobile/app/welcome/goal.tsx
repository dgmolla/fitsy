import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { useTheme } from '@/lib/theme';
import { saveOnboardingField } from '@/lib/onboardingStorage';

type Goal = 'lose_fat' | 'maintain' | 'build_muscle';
type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const GOALS: { id: Goal; icon: IoniconsName; title: string; desc: string }[] = [
  {
    id: 'lose_fat',
    icon: 'trending-down-outline',
    title: 'Lose Fat',
    desc: 'Reduce body fat while preserving muscle',
  },
  {
    id: 'maintain',
    icon: 'resize-outline',
    title: 'Maintain',
    desc: 'Stay at your current weight and composition',
  },
  {
    id: 'build_muscle',
    icon: 'trending-up-outline',
    title: 'Build Muscle',
    desc: 'Increase muscle mass with a calorie surplus',
  },
];

export default function GoalScreen() {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<Goal | null>(null);

  return (
    <WelcomeScreen
      step={5}
      totalSteps={9}
      title="What's your goal?"
      subtitle="We'll set your macro targets to match. You can always change this later."
      onContinue={async () => {
        if (selected) await saveOnboardingField('goal', selected);
        router.push({ pathname: '/macro-setup', params: { fromOnboarding: '1' } });
      }}
      canContinue={selected !== null}
    >
      <View style={styles.cards}>
        {GOALS.map((g) => {
          const active = selected === g.id;
          return (
            <Pressable
              key={g.id}
              style={[
                styles.card,
                { backgroundColor: colors.bgCard, borderColor: colors.border },
                active && { borderColor: colors.accent, backgroundColor: colors.accentBg },
              ]}
              onPress={() => setSelected(g.id)}
              accessibilityRole="button"
              accessibilityLabel={g.title}
              accessibilityState={{ selected: active }}
            >
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: colors.bgElevated },
                  active && { backgroundColor: colors.accent },
                ]}
              >
                <Ionicons
                  name={g.icon}
                  size={24}
                  color={active ? colors.accentOnAccent : colors.textSecondary}
                />
              </View>
              <View style={styles.cardText}>
                <Text
                  style={[
                    styles.cardTitle,
                    { color: colors.textPrimary },
                    active && { color: colors.accent },
                  ]}
                >
                  {g.title}
                </Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                  {g.desc}
                </Text>
              </View>
              {active ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </WelcomeScreen>
  );
}

const styles = StyleSheet.create({
  cards: { flex: 1, marginTop: -8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 2,
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardDesc: { fontSize: 13, marginTop: 2 },
});
