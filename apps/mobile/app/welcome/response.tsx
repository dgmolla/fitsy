import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { useStats } from '@/lib/useStats';

interface ResponseConfig {
  headline: string;
  body: string;
  callout?: string;
}

function getResponse(tried: string, totalDishes: number): ResponseConfig {
  const dishCount = totalDishes.toLocaleString();
  switch (tried) {
    case 'nothing':
      return {
        headline: "No worries —\nthat's why we're here.",
        body: "Fitsy does the hard part. You just pick a restaurant and eat.",
      };
    case 'meal_prep':
      return {
        headline: "Meal prep works.\nUntil it doesn't.",
        body: "Sunday cooking is great in theory. But life happens — meetings run late, plans change, and those containers sit in the fridge. Fitsy gives you a macro-friendly backup for every meal out.",
        callout: "No prep. No Tupperware. Just restaurants that fit.",
      };
    case 'delivery':
      return {
        headline: "Delivery apps don't\nshow you macros.",
        body: "You can order anything on Uber Eats or DoorDash — but none of them tell you the protein, carbs, or fat in what you're ordering. You're flying blind on nutrition. And the subscription fees add up too.",
        callout: "Fitsy adds the macro data they're missing.",
      };
    case 'calorie_apps':
      return {
        headline: "Counting calories\ngets old.",
        body: "Scanning barcodes, estimating portions, logging every snack — it works until you burn out. Fitsy flips it: instead of tracking what you ate, we show you what to eat before you order.",
        callout: "No logging. No scanning. Just results.",
      };
    case 'check_online':
      return {
        headline: "Googling macros\nonly gets you so far.",
        body: "Chain restaurants publish nutrition data. But your favorite local spot? Good luck. Fitsy analyzes menus from local restaurants so you get macro data no one else has.",
        callout: `We've analyzed ${dishCount}+ dishes — most from local spots.`,
      };
    default:
      return {
        headline: "You've put in\nthe work.",
        body: "Fitsy takes a different approach — instead of changing how you eat, we find restaurants that already fit your targets.",
      };
  }
}

export default function ResponseScreen() {
  const { tried } = useLocalSearchParams<{ tried?: string }>();
  const { totalDishes } = useStats();
  const config = getResponse(tried ?? '', totalDishes);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={16} style={s.back} accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
          </Pressable>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round((2 / 16) * 100)}%` }]} />
          </View>
        </View>

        <Animated.Text entering={FadeInDown.duration(500)} style={s.headline}>
          {config.headline}
        </Animated.Text>

        <Animated.Text entering={FadeInDown.duration(500).delay(100)} style={s.body}>
          {config.body}
        </Animated.Text>

        {config.callout && (
          <Animated.View entering={FadeInDown.duration(400).delay(250)} style={s.calloutCard}>
            <Text style={s.calloutText}>{config.callout}</Text>
          </Animated.View>
        )}

        <View style={{ flex: 1 }} />

        <Animated.View entering={FadeIn.duration(400).delay(400)}>
          <AnimatedPress
            style={s.cta}
            onPress={() => router.push('/welcome/promise')}
            haptic
            accessibilityRole="button"
          >
            <Text style={s.ctaTxt}>Here's what we do</Text>
            <Ionicons name="arrow-forward" size={15} color={EDITORIAL.cream} />
          </AnimatedPress>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flex: 1, paddingHorizontal: 36, paddingBottom: 40 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
  },
  back: { width: 44, height: 44, justifyContent: 'center' },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: EDITORIAL.border,
    borderRadius: 2,
    marginLeft: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: EDITORIAL.greenAccent,
    borderRadius: 2,
  },

  headline: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 30,
    color: EDITORIAL.text,
    letterSpacing: -1.2,
    lineHeight: 38,
    marginBottom: 16,
    marginTop: 8,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: EDITORIAL.textSoft,
    marginBottom: 28,
  },

  calloutCard: {
    backgroundColor: EDITORIAL.green,
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 24,
  },
  calloutText: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 18,
    color: EDITORIAL.cream,
    letterSpacing: -0.3,
    lineHeight: 26,
  },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    borderRadius: 32,
    paddingVertical: 18,
  },
  ctaTxt: { fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
});
