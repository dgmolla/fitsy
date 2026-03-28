import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

export type FitsyLoaderSize = 'sm' | 'md' | 'lg';

interface FitsyLoaderProps {
  size?: FitsyLoaderSize;
}

const LETTERS = ['F', 'I', 'T', 'S', 'Y'] as const;

const FONT_SIZES: Record<FitsyLoaderSize, number> = {
  sm: 20,
  md: 32,
  lg: 48,
};

const ACCENT_COLOR = '#2D7D46';
const STAGGER_MS = 90;
const BOUNCE_MS = 200;
const LOOP_MS = (LETTERS.length - 1) * STAGGER_MS + BOUNCE_MS + 400;

function LetterBounce({ letter, index, fontSize }: { letter: string; index: number; fontSize: number }) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const delay = index * STAGGER_MS;
    const tailDelay = LOOP_MS - delay - BOUNCE_MS;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(translateY, { toValue: -12, duration: BOUNCE_MS / 2, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: BOUNCE_MS / 2, useNativeDriver: true }),
        Animated.delay(tailDelay),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [index, translateY]);

  return (
    <Animated.Text style={[styles.letter, { fontSize, transform: [{ translateY }] }]}>
      {letter}
    </Animated.Text>
  );
}

export function FitsyLoader({ size = 'md' }: FitsyLoaderProps) {
  const fontSize = FONT_SIZES[size];

  return (
    <View style={styles.container} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {LETTERS.map((letter, index) => (
        <LetterBounce key={letter} letter={letter} index={index} fontSize={fontSize} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    color: ACCENT_COLOR,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
});
