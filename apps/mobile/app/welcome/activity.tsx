import React, { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ContinueButton } from '@/components/ContinueButton';
import { ProgressDots } from '@/components/ProgressDots';
import { SelectionCard } from '@/components/SelectionCard';

type ActivityLevel = 'sedentary' | 'lightly_active' | 'active' | 'very_active';

const ACTIVITY_OPTIONS: {
  id: ActivityLevel;
  icon: React.ComponentProps<typeof SelectionCard>['icon'];
  title: string;
  subtitle: string;
}[] = [
  {
    id: 'sedentary',
    icon: 'desktop-outline',
    title: 'Sedentary',
    subtitle: 'Little or no exercise, desk job',
  },
  {
    id: 'lightly_active',
    icon: 'walk-outline',
    title: 'Lightly Active',
    subtitle: 'Light exercise 1-3 days/week',
  },
  {
    id: 'active',
    icon: 'bicycle-outline',
    title: 'Active',
    subtitle: 'Moderate exercise 3-5 days/week',
  },
  {
    id: 'very_active',
    icon: 'barbell-outline',
    title: 'Very Active',
    subtitle: 'Hard exercise 6-7 days/week',
  },
];

export default function ActivityScreen() {
  const [selected, setSelected] = useState<ActivityLevel | null>(null);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <ProgressDots current={4} total={7} />
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.title}>How active are you?</Text>
          <Text style={styles.subtitle}>Pick the level that best describes your typical week.</Text>
        </View>

        <ScrollView style={styles.cards} showsVerticalScrollIndicator={false}>
          {ACTIVITY_OPTIONS.map((option) => (
            <SelectionCard
              key={option.id}
              icon={option.icon}
              title={option.title}
              subtitle={option.subtitle}
              selected={selected === option.id}
              onPress={() => setSelected(option.id)}
            />
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <ContinueButton
            onPress={() => router.push('/welcome/goal')}
            disabled={selected === null}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  titleSection: {
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    lineHeight: 22,
  },
  cards: {
    flex: 1,
    marginTop: 16,
  },
  footer: {
    paddingTop: 16,
  },
});
