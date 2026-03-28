import React, { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ContinueButton } from '@/components/ContinueButton';
import { ProgressDots } from '@/components/ProgressDots';
import { SelectionCard } from '@/components/SelectionCard';

type Goal = 'lose_fat' | 'maintain' | 'build_muscle';

const GOAL_OPTIONS: {
  id: Goal;
  icon: React.ComponentProps<typeof SelectionCard>['icon'];
  title: string;
  subtitle: string;
}[] = [
  {
    id: 'lose_fat',
    icon: 'trending-down-outline',
    title: 'Lose Fat',
    subtitle: 'Reduce body fat while preserving muscle',
  },
  {
    id: 'maintain',
    icon: 'resize-outline',
    title: 'Maintain',
    subtitle: 'Stay at your current weight and composition',
  },
  {
    id: 'build_muscle',
    icon: 'trending-up-outline',
    title: 'Build Muscle',
    subtitle: 'Increase muscle mass with a calorie surplus',
  },
];

export default function GoalScreen() {
  const [selected, setSelected] = useState<Goal | null>(null);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <ProgressDots current={5} total={7} />
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.title}>What is your goal?</Text>
          <Text style={styles.subtitle}>We will set your macro targets based on this.</Text>
        </View>

        <ScrollView style={styles.cards} showsVerticalScrollIndicator={false}>
          {GOAL_OPTIONS.map((option) => (
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
            onPress={() => router.push('/welcome/payment')}
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
