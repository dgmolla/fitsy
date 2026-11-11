import { requireWelcomeGoal } from '@/lib/requireWelcomeGoal';
import React, { useEffect } from 'react';
import { Alert, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, FONTS, TEXT } from '@/lib/brand';
import { useOnboardingStep } from '@/lib/onboardingResume';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { rememberOnboardingPreviewEntry } from '@/lib/onboardingPreviewEntry';

const CARDS = [
  { key: 'published', emoji: '🧾', label: 'Published', title: 'Chain restaurants', body: "Straight from the official menu - exact macros." },
  { key: 'estimated', emoji: '🔎', label: 'Estimated', title: 'Mom-and-pop spots', body: "Our best approximation when a menu isn't published." },
] as const;

function HowItWorksScreen() {
  useOnboardingStep('how-it-works');
  useEffect(() => { trackOnboardingScreenView('how_it_works'); }, []);
  const { height } = useWindowDimensions();
  const compact = height < 780;
  return <WelcomeScreen progress={0.61} title={"Two data\nsources."}
    canContinue onContinue={() => { void rememberOnboardingPreviewEntry()
      .then(() => router.push('/welcome/preview'))
      .catch(() => Alert.alert('Could not open preview', 'Please try again.')); }}>
    <View style={[s.cards, compact && s.cardsCompact]}>
      {CARDS.map(card => (
        <View key={card.key} style={s.card} testID={`nutrition-source-${card.key}`}>
          <View style={[s.cardVisual, compact && s.cardVisualCompact]}><Text style={s.emoji}>{card.emoji}</Text></View>
          <View style={s.cardBody}>
            <Text style={s.cardLabel}>{card.label}</Text>
            <Text style={s.cardTitle}>{card.title}</Text>
            <Text style={s.cardText}>{card.body}</Text>
          </View>
        </View>
      ))}
    </View>
  </WelcomeScreen>;
}
const s = StyleSheet.create({
  cards: { gap: 16, paddingVertical: 24 },
  cardsCompact: { gap: 10, paddingVertical: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: EDITORIAL.cream, borderRadius: 18, padding: 10,
    borderWidth: 1, borderColor: EDITORIAL.creamDeep },
  cardVisual: { width: 64, height: 64, borderRadius: 14, backgroundColor: EDITORIAL.greenAccentTint, alignItems: 'center', justifyContent: 'center' },
  cardVisualCompact: { width: 52, height: 52, borderRadius: 12 },
  emoji: { fontSize: 28 },
  cardBody: { flex: 1, gap: 2 },
  cardLabel: { ...TEXT.caption, color: EDITORIAL.green, textTransform: 'uppercase' },
  cardTitle: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, color: EDITORIAL.green },
  cardText: { ...TEXT.body, fontSize: 13, lineHeight: 18, color: EDITORIAL.textMid },
});

export default requireWelcomeGoal(HowItWorksScreen, '/welcome/target-setup');
