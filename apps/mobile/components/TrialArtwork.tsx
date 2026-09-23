import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, TEXT } from '@/lib/brand';

export function TrialArtwork({ reminder = false }: { reminder?: boolean }) {
  return <View style={s.wrap} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={s.orbit}><View style={s.inner}><Ionicons name={reminder ? 'notifications-outline' : 'restaurant-outline'} size={58} color={EDITORIAL.green} /></View></View>
    <View style={s.badge}><Ionicons name="checkmark-circle" size={20} color={EDITORIAL.greenMid} /><Text style={s.badgeText}>{reminder ? 'A little heads-up' : 'Meals that fit your goals'}</Text></View>
  </View>;
}
const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 34 },
  orbit: { width: 192, height: 192, borderRadius: 96, borderWidth: 1, borderColor: EDITORIAL.border, alignItems: 'center', justifyContent: 'center' },
  inner: { width: 150, height: 150, borderRadius: 75, backgroundColor: EDITORIAL.greenAccentTint, alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 24, backgroundColor: EDITORIAL.cream, borderWidth: 1, borderColor: EDITORIAL.border, marginTop: -18 },
  badgeText: { ...TEXT.bodySmall, color: EDITORIAL.green },
});
