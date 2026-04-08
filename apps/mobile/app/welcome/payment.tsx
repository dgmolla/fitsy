import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pushProfileToServer } from '@/lib/profileSync';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, FONTS } from '@/lib/brand';

type PlanId = 'monthly' | 'yearly';

const FEATURES = [
  'Macro-aware restaurant search',
  'Published chain nutrition data',
  'AI-estimated macros for local spots',
  'Confidence scores on every estimate',
  'Unlimited searches',
];

const PLANS: { id: PlanId; label: string; price: string; perMonth: string; badge?: string }[] = [
  { id: 'yearly', label: 'Annual', price: '$29.99 / year', perMonth: '$2.50 / mo', badge: 'Best Value' },
  { id: 'monthly', label: 'Monthly', price: '$4.99 / month', perMonth: '' },
];

export default function PaymentScreen() {
  const [plan, setPlan] = useState<PlanId>('yearly');
  const [loading, setLoading] = useState(false);

  async function handleStart() {
    setLoading(true);
    try {
      await AsyncStorage.setItem('onboardingComplete', 'true');
      pushProfileToServer();
      router.push('/welcome/signin');
    } finally {
      setLoading(false);
    }
  }

  return (
    <WelcomeScreen
      step={7}
      totalSteps={8}
      title="Try Fitsy free for 7 days."
      subtitle="No charge until your trial ends. Cancel anytime."
      onContinue={handleStart}
      canContinue={!loading}
      continueLabel={loading ? 'Setting up...' : 'Start Free Trial'}
    >
      <View style={styles.features}>
        {FEATURES.map((f) => (
          <View key={f} style={styles.featureRow}>
            <Ionicons name="checkmark-circle" size={20} color={EDITORIAL.greenAccent} />
            <Text style={styles.featureTxt}>{f}</Text>
          </View>
        ))}
      </View>

      <View style={styles.plans}>
        {PLANS.map((p) => {
          const active = plan === p.id;
          return (
            <Pressable
              key={p.id}
              style={[styles.planCard, active && styles.planCardActive]}
              onPress={() => setPlan(p.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View style={styles.planLeft}>
                <Text style={[styles.planLabel, active && { color: EDITORIAL.green }]}>{p.label}</Text>
                {p.perMonth ? <Text style={styles.planSub}>{p.perMonth}</Text> : null}
              </View>
              <View style={styles.planRight}>
                {p.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>{p.badge}</Text>
                  </View>
                ) : null}
                <Text style={[styles.planPrice, active && { color: EDITORIAL.green }]}>{p.price}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.disclaimer}>
        {`No charge for 7 days. Then ${plan === 'yearly' ? '$29.99/year' : '$4.99/month'}. Cancel before trial ends to avoid charge.`}
      </Text>
    </WelcomeScreen>
  );
}

const styles = StyleSheet.create({
  features: { gap: 12, marginBottom: 24 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureTxt: { fontSize: 15, color: EDITORIAL.text, flex: 1 },
  plans: { gap: 10, marginBottom: 16 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: EDITORIAL.border,
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 14,
    padding: 16,
  },
  planCardActive: {
    borderColor: EDITORIAL.greenAccent,
    backgroundColor: EDITORIAL.creamDeep,
  },
  planLeft: { gap: 2 },
  planLabel: { fontFamily: FONTS.newsreaderBold, fontSize: 16, color: EDITORIAL.text },
  planSub: { fontSize: 13, color: EDITORIAL.textSoft },
  planRight: { alignItems: 'flex-end', gap: 4 },
  badge: { backgroundColor: EDITORIAL.green, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeTxt: { fontSize: 11, fontWeight: '600', color: EDITORIAL.cream },
  planPrice: { fontSize: 15, fontWeight: '600', color: EDITORIAL.text },
  disclaimer: { fontSize: 12, textAlign: 'center', lineHeight: 18, color: EDITORIAL.textSoft },
});
