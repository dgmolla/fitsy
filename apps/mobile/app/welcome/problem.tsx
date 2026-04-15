import React, { useEffect, useRef } from 'react';
import { Animated as RNAnimated, Dimensions, Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { router } from 'expo-router';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { DISHES } from '@/lib/dishImages';

const { width: W, height: H } = Dimensions.get('window');
const GAP = 8;
const COL_W = (W - GAP * 3) / 2;
const RADIUS = 14;

// Build two columns of images with varying heights
function buildColumns() {
  const heights = [180, 220, 160, 240, 200, 180, 220, 200, 160];
  const left: { source: any; h: number }[] = [];
  const right: { source: any; h: number }[] = [];

  DISHES.forEach((source, i) => {
    const h = heights[i % heights.length]!;
    if (i % 2 === 0) left.push({ source, h });
    else right.push({ source, h });
  });

  // Duplicate for seamless loop
  return {
    left: [...left, ...left, ...left],
    right: [...right, ...right, ...right],
  };
}

const COLUMNS = buildColumns();

// Total height of a column for scroll calculation
function colHeight(items: { h: number }[]) {
  return items.reduce((sum, item) => sum + item.h + GAP, 0);
}

function ScrollingColumn({ items, speed, offset }: { items: { source: any; h: number }[]; speed: number; offset: number }) {
  const translateY = useRef(new RNAnimated.Value(0)).current;
  const totalH = colHeight(items) / 3; // one set height (we tripled)

  useEffect(() => {
    translateY.setValue(-offset);
    RNAnimated.loop(
      RNAnimated.timing(translateY, {
        toValue: -offset - totalH,
        duration: totalH * speed,
        useNativeDriver: true,
        easing: require('react-native').Easing.linear,
      }),
    ).start();
  }, [translateY, totalH, speed, offset]);

  return (
    <RNAnimated.View style={[s.column, { transform: [{ translateY }] }]}>
      {items.map((item, i) => (
        <View key={i} style={[s.tile, { width: COL_W, height: item.h }]}>
          <Image source={item.source} style={s.tileImg} resizeMode="cover" />
        </View>
      ))}
    </RNAnimated.View>
  );
}

export default function ProblemScreen() {
  return (
    <View style={s.container}>
      {/* Scrolling mosaic grid */}
      <View style={s.grid}>
        <ScrollingColumn items={COLUMNS.left} speed={80} offset={0} />
        <ScrollingColumn items={COLUMNS.right} speed={65} offset={80} />
      </View>

      {/* Dark overlay */}
      <View style={s.overlay} />

      <SafeAreaView style={s.content}>
        <View style={s.center}>
          <Animated.Text entering={FadeIn.duration(600)} style={s.text}>
            restaurants near you{'\n'}that fit your{'\n'}fitness goals.
          </Animated.Text>

          <Animated.View entering={FadeIn.duration(500).delay(400)} style={s.footerInner}>
            <AnimatedPress
              style={s.cta}
              onPress={() => router.push('/welcome/tried')}
              haptic
              accessibilityRole="button"
            >
              <Text style={s.ctaTxt}>continue</Text>
            </AnimatedPress>
            <Pressable onPress={() => router.push('/auth/login')} hitSlop={12} accessibilityRole="button">
              <Text style={s.login}>
                Have an account? <Text style={s.loginLink}>Log in</Text>
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0E0C', overflow: 'hidden' },

  grid: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    paddingHorizontal: GAP,
    gap: GAP,
  },
  column: {
    width: COL_W,
    gap: GAP,
  },
  tile: {
    borderRadius: RADIUS,
    overflow: 'hidden',
  },
  tileImg: {
    width: '100%',
    height: '100%',
  },

  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  content: { flex: 1, paddingHorizontal: 36, paddingBottom: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 28 },
  text: { fontFamily: FONTS.newsreaderBold, fontSize: 28, color: EDITORIAL.cream, letterSpacing: -1, lineHeight: 40, textAlign: 'center' },
  footerInner: { alignItems: 'center', gap: 20 },
  cta: { backgroundColor: 'rgba(253,251,247,0.15)', borderRadius: 32, paddingVertical: 14, paddingHorizontal: 32 },
  ctaTxt: { fontSize: 15, fontWeight: '500', color: EDITORIAL.cream },
  login: { fontSize: 13, color: 'rgba(253,251,247,0.4)' },
  loginLink: { color: 'rgba(253,251,247,0.65)', fontWeight: '600' },
});
