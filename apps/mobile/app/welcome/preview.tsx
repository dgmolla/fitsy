import React from 'react';
import { Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';

const RESTAURANTS = [
  { name: 'Pine and Crane', dish: 'Example meal', cal: 580, p: 32, dist: '0.4 mi', img: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&q=70' },
  { name: 'Great White', dish: 'Example meal', cal: 520, p: 38, dist: '0.8 mi', img: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=400&q=70' },
  { name: 'Luv2eat Thai', dish: 'Example meal', cal: 490, p: 28, dist: '1.2 mi', img: 'https://images.unsplash.com/photo-1559314809-0d155014e29e?w=400&q=70' },
];

export default function PreviewScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={s.back} accessibilityRole="button">
          <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
        </Pressable>

        <Animated.Text entering={FadeInDown.duration(500)} style={s.title}>
          Let's find your{'\n'}first meal.
        </Animated.Text>

        <View style={s.cards}>
          {RESTAURANTS.map((r, i) => (
            <Animated.View key={r.name} entering={FadeInDown.duration(400).delay(150 + i * 80)}>
              <View style={s.card}>
                <Image source={{ uri: r.img }} style={s.cardImg} resizeMode="cover" />
                <LinearGradient colors={['transparent', EDITORIAL.heroGrad]} style={s.grad} />
                <View style={s.info}>
                  <Text style={s.idx}>{String(i + 1).padStart(2, '0')}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{r.name}</Text>
                    <Text style={s.meta}>{r.dish} · {r.cal} kcal · P {r.p}g</Text>
                  </View>
                  <Text style={s.dist}>{r.dist}</Text>
                </View>
              </View>
            </Animated.View>
          ))}
        </View>

        <View style={{ flex: 1 }} />

        <Animated.View entering={FadeIn.duration(400).delay(600)}>
          <AnimatedPress
            style={s.cta}
            onPress={() => router.push('/welcome/how-it-works')}
            haptic
            accessibilityRole="button"
          >
            <Text style={s.ctaTxt}>How does it work?</Text>
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
  back: { width: 44, height: 52, justifyContent: 'center' },
  title: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 30,
    color: EDITORIAL.text,
    letterSpacing: -1.2,
    lineHeight: 42,
    marginBottom: 32,
  },
  cards: { gap: 12 },
  card: { height: 88, borderRadius: 16, overflow: 'hidden', backgroundColor: EDITORIAL.creamDeep },
  cardImg: { width: '100%', height: '100%' },
  grad: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '100%' },
  info: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  idx: { fontSize: 11, fontWeight: '800', color: 'rgba(253,251,247,0.4)', letterSpacing: 0.5 },
  name: { fontFamily: FONTS.newsreaderBold, fontSize: 16, color: EDITORIAL.cream, letterSpacing: -0.3 },
  meta: { fontSize: 11, color: 'rgba(253,251,247,0.6)' },
  dist: { fontSize: 11, fontWeight: '600', color: 'rgba(253,251,247,0.45)' },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18,
  },
  ctaTxt: { fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
});
