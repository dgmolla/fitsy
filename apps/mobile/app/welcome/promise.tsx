import React, { useEffect } from 'react';
import { Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS, TEXT } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { trackOnboardingScreenView } from '@/lib/analytics';

export default function PromiseScreen() {
  useEffect(() => {
    trackOnboardingScreenView('promise');
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={16} style={s.back} accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
          </Pressable>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round((1 / 18) * 100)}%` }]} />
          </View>
        </View>

        <Animated.Text entering={FadeInDown.duration(600)} style={s.headline}>
          Healthy meals{'\n'}near you
        </Animated.Text>

        <Animated.Text entering={FadeInDown.duration(500).delay(100)} style={s.sub}>
          Filter nearby restaurant meals by macros and calories.
        </Animated.Text>

        <View style={s.cards}>
          <Animated.View entering={FadeInDown.duration(500).delay(200)} style={s.card}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&q=70' }}
              style={s.cardImg}
              resizeMode="cover"
            />
            <LinearGradient colors={['transparent', EDITORIAL.heroGrad]} style={s.grad} />
            <View style={s.cardInfo}>
              <Text style={s.cardIdx}>01</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.cardName}>Example Restaurant 1</Text>
                <Text style={s.cardMeta}>Example meal · P 32g · C 60g · F 20g</Text>
              </View>
              <Text style={s.cardDist}>0.4 mi</Text>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(500).delay(320)} style={s.card}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=400&q=70' }}
              style={s.cardImg}
              resizeMode="cover"
            />
            <LinearGradient colors={['transparent', EDITORIAL.heroGrad]} style={s.grad} />
            <View style={s.cardInfo}>
              <Text style={s.cardIdx}>02</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.cardName}>Example Restaurant 2</Text>
                <Text style={s.cardMeta}>Example meal · P 38g · C 45g · F 18g</Text>
              </View>
              <Text style={s.cardDist}>0.8 mi</Text>
            </View>
          </Animated.View>
        </View>

        <View style={{ flex: 1 }} />

        <Animated.View entering={FadeInDown.duration(500).delay(400)}>
          <AnimatedPress
            style={s.cta}
            onPress={() => router.push('/welcome/tried')}
            haptic
            accessibilityRole="button"
          >
            <Text style={s.ctaTxt}>How does this work?</Text>
            <Ionicons name="arrow-forward" size={16} color={EDITORIAL.cream} />
          </AnimatedPress>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flex: 1, paddingHorizontal: 32, paddingBottom: 32 },
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

  headline: { ...TEXT.headline, marginBottom: 14 },
  sub: { ...TEXT.subtitle, fontSize: 15, lineHeight: 26, marginBottom: 28 },

  cards: { gap: 12 },
  card: { height: 100, borderRadius: 16, overflow: 'hidden', backgroundColor: EDITORIAL.creamDeep },
  cardImg: { width: '100%', height: '100%' },
  grad: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '100%' },
  cardInfo: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  cardIdx: { ...TEXT.caption, color: 'rgba(253,251,247,0.4)' },
  cardName: TEXT.cardTitle,
  cardMeta: { ...TEXT.cardMeta, color: 'rgba(253,251,247,0.6)' },
  cardDist: { ...TEXT.caption, letterSpacing: 0, color: 'rgba(253,251,247,0.45)' },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18,
  },
  ctaTxt: { ...TEXT.cta, fontSize: 16 },
});
