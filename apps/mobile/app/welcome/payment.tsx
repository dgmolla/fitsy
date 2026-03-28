import React, { useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { ContinueButton } from '@/components/ContinueButton';
import { ProgressDots } from '@/components/ProgressDots';

type PlanId = 'monthly' | 'yearly';

const FEATURES = [
  'Macro-aware restaurant search',
  'Personalized daily targets',
  'Nutritional confidence scores',
  'Unlimited searches',
];

const PLANS: { id: PlanId; label: string; price: string; perMonth: string; badge?: string }[] = [
  {
    id: 'yearly',
    label: 'Annual',
    price: '$29.99 / year',
    perMonth: '$2.50 / mo',
    badge: 'Best Value',
  },
  {
    id: 'monthly',
    label: 'Monthly',
    price: '$4.99 / month',
    perMonth: '',
  },
];

export default function PaymentScreen() {
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('yearly');
  const [loading, setLoading] = useState(false);

  async function handleStartTrial() {
    setLoading(true);
    try {
      await AsyncStorage.setItem('onboardingComplete', 'true');
      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <ProgressDots current={7} total={7} />
        </View>

        <View style={styles.heroSection}>
          <Text style={styles.title}>Start your free trial</Text>
          <Text style={styles.subtitle}>Try Fitsy free for 7 days. Cancel anytime.</Text>
        </View>

        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={20} color="#2D7D46" />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        <View style={styles.plans}>
          {PLANS.map((plan) => (
            <Pressable
              key={plan.id}
              style={[styles.planCard, selectedPlan === plan.id && styles.planCardSelected]}
              onPress={() => setSelectedPlan(plan.id)}
              accessibilityRole="button"
              accessibilityLabel={plan.label}
              accessibilityState={{ selected: selectedPlan === plan.id }}
            >
              <View style={styles.planLeft}>
                <Text style={[styles.planLabel, selectedPlan === plan.id && styles.planLabelSelected]}>
                  {plan.label}
                </Text>
                {plan.perMonth ? (
                  <Text style={styles.planPerMonth}>{plan.perMonth}</Text>
                ) : null}
              </View>
              <View style={styles.planRight}>
                {plan.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{plan.badge}</Text>
                  </View>
                ) : null}
                <Text style={[styles.planPrice, selectedPlan === plan.id && styles.planPriceSelected]}>
                  {plan.price}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <View style={styles.cta}>
          <ContinueButton
            label={loading ? 'Setting up...' : 'Start Free Trial'}
            onPress={handleStartTrial}
            disabled={loading}
          />
          <Text style={styles.disclaimer}>
            {`No charge for 7 days. Then ${selectedPlan === 'yearly' ? '$29.99/year' : '$4.99/month'}. Cancel before trial ends to avoid charge.`}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 48,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  heroSection: {
    marginBottom: 28,
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
  features: {
    gap: 12,
    marginBottom: 28,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureText: {
    fontSize: 15,
    color: '#374151',
    flex: 1,
  },
  plans: {
    gap: 10,
    marginBottom: 28,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  planCardSelected: {
    borderColor: '#2D7D46',
    backgroundColor: '#F0FDF4',
  },
  planLeft: {
    gap: 2,
  },
  planLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  planLabelSelected: {
    color: '#1A5C32',
  },
  planPerMonth: {
    fontSize: 13,
    color: '#6B7280',
  },
  planRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  badge: {
    backgroundColor: '#2D7D46',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  planPrice: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  planPriceSelected: {
    color: '#1A5C32',
  },
  cta: {
    gap: 12,
  },
  disclaimer: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 18,
  },
});
