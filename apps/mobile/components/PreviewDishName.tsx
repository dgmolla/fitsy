import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { BlurFallback } from '@/lib/BlurFallback';

/** A blurred name teaser without exposing the hidden dish through accessibility. */
export function PreviewDishName({ restaurantId }: { restaurantId: string }) {
  return <View style={s.wrap} testID={`preview-hidden-dish-${restaurantId}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={s.words}><View style={[s.word, s.long]} /><View style={[s.word, s.short]} /></View>
    <BlurFallback tint="dark" intensity={26} fallbackColor="rgba(20,45,30,0.25)" style={StyleSheet.absoluteFillObject as ViewStyle} />
  </View>;
}
const s = StyleSheet.create({
  wrap: { height: 24, width: '72%', overflow: 'hidden', borderRadius: 6, marginBottom: 2 },
  words: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center' },
  word: { height: 13, borderRadius: 5, backgroundColor: 'rgba(253,251,247,0.7)' },
  long: { width: '60%' },
  short: { width: '28%' },
});
