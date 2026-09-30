import React from 'react';
import { Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, TEXT } from '@/lib/brand';

export function TrialArtwork({ reminder = false }: { reminder?: boolean }) {
  const { height, fontScale } = useWindowDimensions();
  const compact = height < 780 && fontScale <= 1.2;
  return <View style={[s.wrap, compact && s.wrapCompact]} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {reminder ? <>
      <View style={[s.orbit, compact && s.orbitCompact]}><View style={[s.inner, compact && s.innerCompact]}><Ionicons name="notifications-outline" size={compact ? 70 : 88} color={EDITORIAL.green} /></View></View>
      <View style={s.badge}><Ionicons name="checkmark-circle" size={20} color={EDITORIAL.greenMid} /><Text style={s.badgeText}>A little heads-up</Text></View>
    </> : <Image source={require('../assets/app-screenshot.png')} resizeMode="contain" style={[s.appScreenshot, compact && s.appScreenshotCompact]} />}
  </View>;
}
const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 18 },
  wrapCompact: { paddingVertical: 8 },
  appScreenshot: { width: 166, height: 361, borderRadius: 20, borderWidth: 1, borderColor: EDITORIAL.border },
  appScreenshotCompact: { width: 132, height: 287, borderRadius: 16 },
  orbit: { width: 186, height: 186, borderRadius: 93, borderWidth: 1, borderColor: EDITORIAL.border, alignItems: 'center', justifyContent: 'center' },
  orbitCompact: { width: 150, height: 150, borderRadius: 75 },
  inner: { width: 148, height: 148, borderRadius: 74, backgroundColor: EDITORIAL.greenAccentTint, alignItems: 'center', justifyContent: 'center' },
  innerCompact: { width: 120, height: 120, borderRadius: 60 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 24, backgroundColor: EDITORIAL.cream, borderWidth: 1, borderColor: EDITORIAL.border, marginTop: -18 },
  badgeText: { ...TEXT.bodySmall, color: EDITORIAL.green },
});
