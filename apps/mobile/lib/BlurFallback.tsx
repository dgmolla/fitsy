import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Constants from 'expo-constants';
import { BlurView } from 'expo-blur';

const isExpoGo = Constants.appOwnership === 'expo';

interface BlurFallbackProps {
  tint: 'dark' | 'light';
  intensity: number;
  fallbackColor: string;
  style?: ViewStyle;
}

export function BlurFallback({ tint, intensity, fallbackColor, style }: BlurFallbackProps) {
  if (isExpoGo) {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fallbackColor, overflow: 'hidden' }, style]} />
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, style]}>
      <BlurView
        tint={tint}
        intensity={intensity}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
