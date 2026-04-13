import React from 'react';
import { Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';

export default function HowItWorksScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={16} style={s.back} accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
          </Pressable>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round((3 / 14) * 100)}%` }]} />
          </View>
        </View>

        <Animated.Text entering={FadeInDown.duration(500)} style={s.title}>
          Two sources.{'\n'}One goal.
        </Animated.Text>

        <View style={s.panels}>
          {/* Verified — dark green panel with food image */}
          <Animated.View entering={FadeInDown.duration(400).delay(150)} style={s.panelDark}>
            <View style={s.panelDarkContent}>
              <Text style={s.badgeLight}>VERIFIED</Text>
              <Text style={s.titleLight}>Chain{'\n'}restaurants</Text>
              <Text style={s.descLight}>Published nutrition. Exact macros.</Text>
            </View>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300&q=70' }}
              style={s.panelImg}
              resizeMode="cover"
            />
          </Animated.View>

          {/* AI Estimated — cream panel with food image */}
          <Animated.View entering={FadeInDown.duration(400).delay(280)} style={s.panelLight}>
            <View style={s.panelLightContent}>
              <Text style={s.badgeDark}>AI ESTIMATED</Text>
              <Text style={s.titleDark}>Local{'\n'}restaurants</Text>
              <Text style={s.descDark}>AI-analyzed menus. Confidence scores.</Text>
            </View>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1559314809-0d155014e29e?w=300&q=70' }}
              style={s.panelImg}
              resizeMode="cover"
            />
          </Animated.View>
        </View>

        <View style={{ flex: 1 }} />

        <Animated.View entering={FadeIn.duration(400).delay(500)}>
          <AnimatedPress
            style={s.cta}
            onPress={() => router.push('/welcome/data-scale')}
            haptic
            accessibilityRole="button"
          >
            <Text style={s.ctaTxt}>Continue</Text>
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
  title: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 30,
    color: EDITORIAL.text,
    letterSpacing: -1.2,
    lineHeight: 42,
    marginBottom: 32,
  },
  panels: { gap: 14 },

  /* Dark panel */
  panelDark: {
    backgroundColor: EDITORIAL.green,
    borderRadius: 22,
    flexDirection: 'row',
    overflow: 'hidden',
    minHeight: 160,
  },
  panelDarkContent: { flex: 1, padding: 24, gap: 6, justifyContent: 'center' },
  badgeLight: { fontSize: 10, fontWeight: '800', color: 'rgba(253,251,247,0.5)', letterSpacing: 2 },
  titleLight: { fontFamily: FONTS.newsreaderBold, fontSize: 24, color: EDITORIAL.cream, letterSpacing: -0.3, lineHeight: 28 },
  descLight: { fontSize: 14, lineHeight: 20, color: 'rgba(253,251,247,0.6)', marginTop: 4 },

  /* Light panel */
  panelLight: {
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 22,
    flexDirection: 'row',
    overflow: 'hidden',
    minHeight: 160,
  },
  panelLightContent: { flex: 1, padding: 24, gap: 6, justifyContent: 'center' },
  badgeDark: { fontSize: 10, fontWeight: '800', color: EDITORIAL.greenAccent, letterSpacing: 2 },
  titleDark: { fontFamily: FONTS.newsreaderBold, fontSize: 24, color: EDITORIAL.text, letterSpacing: -0.3, lineHeight: 28 },
  descDark: { fontSize: 14, lineHeight: 20, color: EDITORIAL.textSoft, marginTop: 4 },

  panelImg: { width: 110, height: '100%' },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18,
  },
  ctaTxt: { fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
});
