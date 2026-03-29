import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { useTheme } from '@/lib/theme';

type PlanId = 'monthly' | 'yearly';

const FEATURES = [
  'Macro-aware restaurant search',
  'Personalized daily targets',
  'Nutritional confidence scores',
  'Unlimited searches',
];

const PLANS: { id: PlanId; label: string; price: string; perMonth: string; badge?: string }[] = [
  { id: 'yearly', label: 'Annual', price: '$29.99 / year', perMonth: '$2.50 / mo', badge: 'Best Value' },
  { id: 'monthly', label: 'Monthly', price: '$4.99 / month', perMonth: '' },
];

export default function PaymentScreen() {
  const { colors } = useTheme();
  const [plan, setPlan] = useState<PlanId>('yearly');
  const [loading, setLoading] = useState(false);

  async function handleStart() {
    setLoading(true);
    try {
      await AsyncStorage.setItem('onboardingComplete', 'true');
      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  }

  return (
    <WelcomeScreen
      step={7}
      totalSteps={7}
      illustration={<Image source={require('@/assets/illustrations/payment.jpg')} style={{ width: 180, height: 180, resizeMode: 'contain' }} />}
      title="Start your free trial"
      subtitle="Try Fitsy free for 7 days. Cancel anytime before trial ends."
      onContinue={handleStart}
      canContinue={!loading}
      continueLabel={loading ? 'Setting up...' : 'Start Free Trial'}
      scrollable
    >
      {/* Features */}
      <View style={styles.features}>
        {FEATURES.map((f) => (
          <View key={f} style={styles.featureRow}>
            <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
            <Text style={[styles.featureTxt, { color: colors.textPrimary }]}>{f}</Text>
          </View>
        ))}
      </View>

      {/* Plans */}
      <View style={styles.plans}>
        {PLANS.map((p) => {
          const active = plan === p.id;
          return (
            <Pressable
              key={p.id}
              style={[
                styles.planCard,
                { borderColor: colors.border, backgroundColor: colors.bgCard },
                active && { borderColor: colors.accent, backgroundColor: colors.accentBg },
              ]}
              onPress={() => setPlan(p.id)}
              accessibilityRole="button"
              accessibilityLabel={p.label}
              accessibilityState={{ selected: active }}
            >
              <View style={styles.planLeft}>
                <Text
                  style={[
                    styles.planLabel,
                    { color: colors.textPrimary },
                    active && { color: colors.accent },
                  ]}
                >
                  {p.label}
                </Text>
                {p.perMonth ? (
                  <Text style={[styles.planSub, { color: colors.textSecondary }]}>
                    {p.perMonth}
                  </Text>
                ) : null}
              </View>
              <View style={styles.planRight}>
                {p.badge ? (
                  <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                    <Text style={[styles.badgeTxt, { color: colors.accentOnAccent }]}>
                      {p.badge}
                    </Text>
                  </View>
                ) : null}
                <Text
                  style={[
                    styles.planPrice,
                    { color: colors.textPrimary },
                    active && { color: colors.accent },
                  ]}
                >
                  {p.price}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.disclaimer, { color: colors.textTertiary }]}>
        {`No charge for 7 days. Then ${plan === 'yearly' ? '$29.99/year' : '$4.99/month'}. Cancel before trial ends to avoid charge.`}
      </Text>
    </WelcomeScreen>
  );
}

const styles = StyleSheet.create({
  features: { gap: 12, marginBottom: 24 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureTxt: { fontSize: 15, flex: 1 },
  plans: { gap: 10, marginBottom: 16 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderRadius: 14,
    padding: 16,
  },
  planLeft: { gap: 2 },
  planLabel: { fontSize: 16, fontWeight: '600' },
  planSub: { fontSize: 13 },
  planRight: { alignItems: 'flex-end', gap: 4 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeTxt: { fontSize: 11, fontWeight: '600' },
  planPrice: { fontSize: 15, fontWeight: '600' },
  disclaimer: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
