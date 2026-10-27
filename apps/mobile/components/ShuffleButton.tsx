import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { EDITORIAL } from '@/lib/brand';
import { useShuffleFlag } from '@/lib/useShuffleFlag';

export function ShuffleButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  const { shuffleDebug } = useLocalSearchParams<{ shuffleDebug?: string }>();
  const enabled = useShuffleFlag(shuffleDebug === '1');
  if (!enabled) return null;
  return <Pressable onPress={onPress} disabled={disabled} hitSlop={10}
    accessibilityRole="button" accessibilityLabel="Shuffle results"
    accessibilityHint="Reorder the current search results"
    accessibilityState={{ disabled }} testID="shuffle-button"
    style={({ pressed }) => [s.button, (disabled || pressed) && s.dimmed]}>
    <Ionicons name="shuffle" size={16} color={EDITORIAL.greenAccent} />
  </Pressable>;
}

const s = StyleSheet.create({
  button: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.45 },
});
