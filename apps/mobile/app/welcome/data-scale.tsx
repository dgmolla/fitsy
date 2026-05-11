import React, { useEffect, useRef, useState } from 'react';
import { Animated as RNAnimated, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { useStats } from '@/lib/useStats';
import { trackOnboardingScreenView } from '@/lib/analytics';

function useCountUp(target: number, duration = 1200, delay = 0) {
  const [value, setValue] = useState(0);
  const anim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    if (target === 0) return;
    anim.setValue(0);
    const timeout = setTimeout(() => {
      anim.addListener(({ value: v }) => setValue(Math.round(v)));
      RNAnimated.timing(anim, {
        toValue: target,
        duration,
        useNativeDriver: false,
        easing: require('react-native').Easing.out(require('react-native').Easing.cubic),
      }).start();
    }, delay);
    return () => { clearTimeout(timeout); anim.removeAllListeners(); };
  }, [anim, target, duration, delay]);

  return value;
}

export default function DataScaleScreen() {
  const stats = useStats();

  const items = useCountUp(stats.totalDishes, 1600, 400);
  const indie = useCountUp(stats.indiePercent, 1200, 700);

  useEffect(() => {
    trackOnboardingScreenView('data_scale');
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={16} style={s.back} accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
          </Pressable>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round((5 / 15) * 100)}%` }]} />
          </View>
        </View>

        <Animated.Text entering={FadeInDown.duration(500)} style={s.title}>
          Data you won't{'\n'}find anywhere else.
        </Animated.Text>

        <Animated.Text entering={FadeInDown.duration(500).delay(100)} style={s.subtitle}>
          We've analyzed menus most apps don't even know exist.
        </Animated.Text>

        {/* Stat cards */}
        <View style={s.stats}>
          <Animated.View entering={FadeInDown.duration(400).delay(300)} style={s.statCard}>
            <Text style={s.statNum}>{items.toLocaleString()}</Text>
            <Text style={s.statLabel}>dishes with macro data</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(400).delay(500)} style={[s.statCard, s.statCardAccent]}>
            <Text style={[s.statNum, s.statNumAccent]}>{indie}%</Text>
            <Text style={[s.statLabel, s.statLabelAccent]}>are local spots — not on MyFitnessPal</Text>
          </Animated.View>
        </View>

        <View style={{ flex: 1 }} />

        <Animated.View entering={FadeIn.duration(400).delay(900)} style={s.footnote}>
          <Ionicons name="location-outline" size={14} color={EDITORIAL.textSoft} />
          <Text style={s.footnoteTxt}>Growing every week in your area</Text>
        </Animated.View>

        <Animated.View entering={FadeIn.duration(400).delay(1000)}>
          <AnimatedPress
            style={s.cta}
            onPress={() => router.push('/welcome/macros-fitsy')}
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
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 30,
    color: EDITORIAL.text,
    letterSpacing: -1.2,
    lineHeight: 38,
    marginBottom: 12,
  },
  subtitle: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 15,
    lineHeight: 22,
    color: EDITORIAL.textSoft,
    marginBottom: 36,
  },

  stats: { gap: 14 },

  statCard: {
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 22,
    paddingVertical: 28,
    paddingHorizontal: 24,
    minHeight: 160,
    justifyContent: 'center' as const,
  },
  statCardAccent: {
    backgroundColor: EDITORIAL.green,
  },

  statNum: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 48,
    color: EDITORIAL.text,
    letterSpacing: -2,
    lineHeight: 52,
  },
  statNumAccent: {
    color: EDITORIAL.cream,
  },

  statLabel: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 15,
    color: EDITORIAL.textSoft,
    marginTop: 4,
    lineHeight: 20,
  },
  statLabelAccent: {
    color: 'rgba(253,251,247,0.6)',
  },

  footnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    marginBottom: 16,
  },
  footnoteTxt: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 13,
    color: EDITORIAL.textSoft,
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
  ctaTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
});
