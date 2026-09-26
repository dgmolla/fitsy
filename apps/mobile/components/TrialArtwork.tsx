import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, TEXT } from '@/lib/brand';

export function TrialArtwork({ reminder = false }: { reminder?: boolean }) {
  const { height, fontScale } = useWindowDimensions();
  const compact = height < 780 && fontScale <= 1.2;
  return <View style={[s.wrap, compact && s.wrapCompact]} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={[s.orbit, compact && s.orbitCompact]}><View style={[s.inner, compact && s.innerCompact]}><Ionicons name={reminder ? 'notifications-outline' : 'restaurant-outline'} size={compact ? 42 : 50} color={EDITORIAL.green} /></View></View>
    <View style={s.badge}><Ionicons name="checkmark-circle" size={20} color={EDITORIAL.greenMid} /><Text style={s.badgeText}>{reminder ? 'A little heads-up' : 'Meals that fit your goals'}</Text></View>
  </View>;
}
const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 18 },
  wrapCompact: { paddingVertical: 8 },
  orbit: { width: 160, height: 160, borderRadius: 80, borderWidth: 1, borderColor: EDITORIAL.border, alignItems: 'center', justifyContent: 'center' },
  orbitCompact: { width: 126, height: 126, borderRadius: 63 },
  inner: { width: 122, height: 122, borderRadius: 61, backgroundColor: EDITORIAL.greenAccentTint, alignItems: 'center', justifyContent: 'center' },
  innerCompact: { width: 96, height: 96, borderRadius: 48 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 24, backgroundColor: EDITORIAL.cream, borderWidth: 1, borderColor: EDITORIAL.border, marginTop: -18 },
  badgeText: { ...TEXT.bodySmall, color: EDITORIAL.green },
});
