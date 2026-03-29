import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { useTheme } from '@/lib/theme';
import { saveOnboardingField } from '@/lib/onboardingStorage';

type ActivityLevel = 'sedentary' | 'lightly_active' | 'active' | 'very_active';
type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const OPTIONS: {
  id: ActivityLevel;
  icon: IoniconsName;
  title: string;
  desc: string;
}[] = [
  { id: 'sedentary', icon: 'leaf-outline', title: 'Sedentary', desc: 'Little or no exercise, desk job' },
  { id: 'lightly_active', icon: 'walk-outline', title: 'Lightly Active', desc: 'Light exercise 1-3 days/week' },
  { id: 'active', icon: 'leaf', title: 'Active', desc: 'Moderate exercise 3-5 days/week' },
  { id: 'very_active', icon: 'flash-outline', title: 'Very Active', desc: 'Hard exercise 6-7 days/week' },
];

export default function ActivityScreen() {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<ActivityLevel | null>(null);

  return (
    <WelcomeScreen
      step={4}
      totalSteps={7}
      illustration={<Image source={require('@/assets/illustrations/activity.png')} style={{ width: 240, height: 240, resizeMode: 'contain' }} />}
      title="How active are you?"
      subtitle="Pick the level that best describes your typical week. Be honest!"
      onContinue={async () => {
        if (selected) await saveOnboardingField('activity', selected);
        router.push('/welcome/goal');
      }}
      canContinue={selected !== null}
      scrollable
    >
      <ScrollView showsVerticalScrollIndicator={false} style={styles.cards}>
        {OPTIONS.map((opt) => {
          const active = selected === opt.id;
          return (
            <Pressable
              key={opt.id}
              style={[
                styles.card,
                { backgroundColor: colors.bgCard, borderColor: colors.border },
                active && { borderColor: colors.accent, backgroundColor: colors.accentBg },
              ]}
              onPress={() => setSelected(opt.id)}
              accessibilityRole="button"
              accessibilityLabel={opt.title}
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
                  name={opt.icon}
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
                  {opt.title}
                </Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                  {opt.desc}
                </Text>
              </View>
              {active ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
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
