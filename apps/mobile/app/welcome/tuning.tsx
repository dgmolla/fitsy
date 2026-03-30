import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { useTheme } from '@/lib/theme';

export default function TuningScreen() {
  const { colors } = useTheme();

  return (
    <WelcomeScreen
      step={8}
      totalSteps={9}
      title="Having a cheat meal?"
      subtitle="Your per-meal targets are a starting point. You can always adjust them on the fly."
      onContinue={() => router.push('/welcome/signin')}
      canContinue={true}
    >
      <View style={styles.cards}>
        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Ionicons name="options-outline" size={24} color={colors.accent} />
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Tap the macro bar</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
              On the search screen, tap your macro targets to adjust them for this meal.
            </Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Ionicons name="refresh-outline" size={24} color={colors.accent} />
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Resets automatically</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
              Your defaults are always there. Temporary changes don't affect your profile.
            </Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Ionicons name="body-outline" size={24} color={colors.accent} />
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Update your stats anytime</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
              Lost weight? Changed your goal? Update in your profile and targets recalculate.
            </Text>
          </View>
        </View>
      </View>
    </WelcomeScreen>
  );
}

const styles = StyleSheet.create({
  cards: { gap: 14 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  cardDesc: { fontSize: 13, lineHeight: 19 },
});
