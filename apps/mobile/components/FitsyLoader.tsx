import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSequence,
  withRepeat,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';

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

// Brand accent color from theme
const ACCENT_COLOR = '#4ADE80';

const BOUNCE_UP_MS = 100;
const BOUNCE_DOWN_MS = 100;
const STAGGER_MS = 90;
const PAUSE_MS = 300;

// Each letter's cycle: delay(index*90) + bounce(200ms) + tail-wait + pause
// Last letter (index 4) starts at 360ms, finishes bounce at 560ms.
// Total loop per letter = (LETTERS.length-1)*STAGGER_MS + BOUNCE_UP_MS + BOUNCE_DOWN_MS + PAUSE_MS
// = 360 + 200 + 300 = 860ms
// For letter at index i: after bounce, wait (4-i)*90 + 300ms then repeat from start

interface LetterBounceProps {
  letter: string;
  index: number;
  fontSize: number;
  reduceMotion: boolean;
  opacityValue: SharedValue<number>;
}

function LetterBounce({ letter, index, fontSize, reduceMotion, opacityValue }: LetterBounceProps) {
  const translateY = useSharedValue(0);
  const startDelay = index * STAGGER_MS;
  // After this letter finishes its bounce, it must wait for remaining letters + pause
  const tailDelay = (LETTERS.length - 1 - index) * STAGGER_MS + PAUSE_MS;

  useEffect(() => {
    if (!reduceMotion) {
      translateY.value = withDelay(
        startDelay,
        withRepeat(
          withSequence(
            withTiming(-14, { duration: BOUNCE_UP_MS, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: BOUNCE_DOWN_MS, easing: Easing.in(Easing.quad) }),
            // hold at 0 for tail + pause before next loop iteration's leading delay
            withTiming(0, { duration: tailDelay }),
          ),
          -1,
          false,
        ),
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return { opacity: opacityValue.value };
    }
    return { transform: [{ translateY: translateY.value }] };
  });

  return (
    <Animated.Text style={[styles.letter, { fontSize }, animatedStyle]}>
      {letter}
    </Animated.Text>
  );
}

export function FitsyLoader({ size = 'md' }: FitsyLoaderProps) {
  const fontSize = FONT_SIZES[size];
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const opacityValue = useSharedValue(1);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) {
      return;
    }
    initialized.current = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      setReduceMotion(enabled);

      if (enabled) {
        opacityValue.value = withRepeat(
          withSequence(
            withTiming(0.4, { duration: 500 }),
            withTiming(1, { duration: 500 }),
          ),
          -1,
          false,
        );
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      style={styles.container}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    >
      {LETTERS.map((letter, index) => (
        <LetterBounce
          key={letter}
          letter={letter}
          index={index}
          fontSize={fontSize}
          reduceMotion={reduceMotion}
          opacityValue={opacityValue}
        />
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
