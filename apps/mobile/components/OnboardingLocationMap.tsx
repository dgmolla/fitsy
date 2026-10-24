import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, TEXT } from '@/lib/brand';

/** Decorative illustration before location permission, not a coverage map. */
export function OnboardingLocationMap() {
  const { height, fontScale } = useWindowDimensions();
  return <View style={[s.map, { height: height < 780 && fontScale <= 1.2 ? 145 : 175 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width="100%" height="100%" viewBox="0 0 320 235" preserveAspectRatio="xMidYMid slice">
      <Rect width="320" height="235" fill={EDITORIAL.creamDeep} />
      <Path d="M-5 44H330M-5 143H330M77-5V245M246-5V245M-10 230L330 6" stroke={EDITORIAL.cream} strokeWidth="13" />
      <Rect x="93" y="64" width="132" height="58" rx="14" fill={EDITORIAL.greenAccentTint} />
      <Rect x="10" y="161" width="51" height="58" rx="10" fill={EDITORIAL.greenAccentTint} />
    </Svg>
    <View style={s.center}><Ionicons name="location" size={42} color={EDITORIAL.green} /><Text style={s.label}>Around you</Text></View>
  </View>;
}
const s = StyleSheet.create({
  map: { marginTop: 4, borderRadius: 24, overflow: 'hidden' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 7 },
  label: { ...TEXT.bodySmall, color: EDITORIAL.green, backgroundColor: EDITORIAL.cream, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 18 },
});
