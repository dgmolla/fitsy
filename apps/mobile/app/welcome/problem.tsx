import React, { useEffect, useState } from 'react';
import { Dimensions, Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { router } from 'expo-router';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { DISHES } from '@/lib/dishImages';

const { width: W, height: H } = Dimensions.get('window');

type Phase = 'line1' | 'line2' | 'cta';

export default function ProblemScreen() {
  const [phase, setPhase] = useState<Phase>('line1');
  const [imgIdx, setImgIdx] = useState(0);

  // Accelerating flash — starts at 800ms, builds to 200ms over ~8s
  useEffect(() => {
    let delay = 600;
    let timer: ReturnType<typeof setTimeout>;

    function tick() {
      setImgIdx((prev) => (prev + 1) % DISHES.length);
      if (delay > 100) delay = Math.max(100, delay - 20);
      timer = setTimeout(tick, delay);
    }

    timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('line2'), 5000);
    const t2 = setTimeout(() => setPhase('cta'), 10000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <View style={s.container}>
      <Image
        source={DISHES[imgIdx]}
        style={[StyleSheet.absoluteFill, { width: W, height: H }]}
        resizeMode="cover"
      />
      <View style={s.overlay} />

      <SafeAreaView style={s.content}>
        <View style={{ flex: 1 }} />

        <View style={s.textArea}>
          {phase === 'line1' && (
            <Animated.Text entering={FadeIn.duration(400)} exiting={FadeOut.duration(300)} style={s.text}>
              so you have{'\n'}fitness goals...
            </Animated.Text>
          )}
          {phase === 'line2' && (
            <Animated.Text entering={FadeIn.duration(400)} exiting={FadeOut.duration(300)} style={s.text}>
              but there's so much{'\n'}good food out there.
            </Animated.Text>
          )}
          {phase === 'cta' && (
            <Animated.Text entering={FadeIn.duration(400)} style={s.text}>
              but there's so much{'\n'}good food out there.
            </Animated.Text>
          )}
        </View>

        <View style={s.footer}>
          {phase === 'cta' && (
            <Animated.View entering={FadeIn.duration(500).delay(200)} style={s.footerInner}>
              <AnimatedPress
                style={s.cta}
                onPress={() => router.push('/welcome/promise')}
                haptic
                accessibilityRole="button"
              >
                <Text style={s.ctaTxt}>find what fits</Text>
              </AnimatedPress>
            </Animated.View>
          )}
        </View>

        <Pressable onPress={() => router.push('/auth/login')} hitSlop={12} style={s.loginWrap} accessibilityRole="button">
          <Text style={s.login}>
            Have an account? <Text style={s.loginLink}>Log in</Text>
          </Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  content: { flex: 1, paddingHorizontal: 36, paddingBottom: 20 },

  textArea: { height: 100, justifyContent: 'flex-end', alignItems: 'center', marginBottom: 32 },
  text: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 28,
    color: EDITORIAL.cream,
    letterSpacing: -1,
    lineHeight: 40,
    textAlign: 'center',
  },

  footer: { height: 56, marginBottom: 16 },
  footerInner: { alignItems: 'center' },
  cta: {
    backgroundColor: 'rgba(253,251,247,0.15)',
    borderRadius: 32,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  ctaTxt: { fontSize: 15, fontWeight: '500', color: EDITORIAL.cream },

  loginWrap: { alignItems: 'center' },
  login: { fontSize: 13, color: 'rgba(253,251,247,0.4)' },
  loginLink: { color: 'rgba(253,251,247,0.65)', fontWeight: '600' },
});
