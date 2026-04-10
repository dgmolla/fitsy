import React, { useEffect, useState } from 'react';
import { Dimensions, Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';

const { width: W } = Dimensions.get('window');

// Floating food images for visual texture
const FOOD_IMGS = [
  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&q=60',
  'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=200&q=60',
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&q=60',
];

export default function WelcomeSplash() {
  const float1 = useSharedValue(0);
  const float2 = useSharedValue(0);

  useEffect(() => {
    float1.value = withRepeat(withTiming(10, { duration: 3000, easing: Easing.inOut(Easing.ease) }), -1, true);
    float2.value = withRepeat(withTiming(-8, { duration: 2500, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);

  const drift1 = useAnimatedStyle(() => ({ transform: [{ translateY: float1.value }] }));
  const drift2 = useAnimatedStyle(() => ({ transform: [{ translateY: float2.value }] }));

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        {/* Floating food images — decorative background texture */}
        <View style={s.floatLayer} pointerEvents="none">
          <Animated.View style={[s.floatImg, { top: '12%', left: -20, opacity: 0.12 }, drift1]}>
            <Image source={{ uri: FOOD_IMGS[0] }} style={s.floatImgInner} resizeMode="cover" />
          </Animated.View>
          <Animated.View style={[s.floatImg, { top: '25%', right: -30, opacity: 0.09 }, drift2]}>
            <Image source={{ uri: FOOD_IMGS[1] }} style={s.floatImgInner} resizeMode="cover" />
          </Animated.View>
          <Animated.View style={[s.floatImg, { bottom: '28%', left: 20, opacity: 0.08 }, drift1]}>
            <Image source={{ uri: FOOD_IMGS[2] }} style={s.floatImgInner} resizeMode="cover" />
          </Animated.View>
        </View>

        <View style={s.spacer} />

        <Animated.View entering={FadeInDown.duration(700)} style={s.hero}>
          <Text style={s.wordmark}>fitsy</Text>
        </Animated.View>

        <Animated.View entering={FadeIn.duration(600).delay(300)} style={s.tagWrap}>
          <Text style={s.tag}>find food that fits.</Text>
          <Text style={s.sub}>you aren't cooking anyway</Text>
        </Animated.View>

        <View style={s.spacer} />

        <Animated.View entering={FadeInUp.duration(500).delay(600)} style={s.actions}>
          <AnimatedPress
            style={s.cta}
            onPress={() => router.push('/welcome/problem')}
            haptic
            accessibilityRole="button"
          >
            <Text style={s.ctaTxt}>Get Started</Text>
            <Ionicons name="arrow-forward" size={18} color={EDITORIAL.cream} />
          </AnimatedPress>

          <Pressable onPress={() => router.push('/auth/login')} hitSlop={12} accessibilityRole="button">
            <Text style={s.login}>
              Already have an account? <Text style={s.loginLink}>Log in</Text>
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flex: 1, paddingHorizontal: 44, paddingBottom: 52, alignItems: 'center' },
  spacer: { flex: 1 },

  floatLayer: { ...StyleSheet.absoluteFillObject },
  floatImg: { position: 'absolute', width: 140, height: 140, borderRadius: 70 },
  floatImgInner: { width: '100%', height: '100%', borderRadius: 70 },

  hero: { alignItems: 'center', marginBottom: 28 },
  wordmark: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 72,
    color: EDITORIAL.green,
    letterSpacing: -3,
  },

  tagWrap: { alignItems: 'center', gap: 10 },
  tag: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 24,
    color: EDITORIAL.text,
    letterSpacing: -0.5,
  },
  sub: {
    fontFamily: FONTS.newsreaderItalic,
    fontSize: 16,
    color: EDITORIAL.textSoft,
  },

  actions: { width: '100%', alignItems: 'center', gap: 24 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: EDITORIAL.green,
    borderRadius: 32,
    paddingVertical: 18,
    width: '100%',
  },
  ctaTxt: { fontSize: 17, fontWeight: '600', color: EDITORIAL.cream },
  login: { fontSize: 14, color: EDITORIAL.textSoft },
  loginLink: { color: EDITORIAL.greenAccent, fontWeight: '600' },
});
