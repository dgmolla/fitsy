import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, TEXT } from '@/lib/brand';
import type { PaywallIntent } from '@/lib/paywallIntent';
import type { StoredMacroTargets } from '@/lib/macroStorage';

export function OnboardingAccountSummary({ intent, targets }: { intent: PaywallIntent; targets: StoredMacroTargets | null }) {
  const name = intent.restaurantName;
  return <View style={s.wrap}>
    <View style={s.card} testID="signup-selected-restaurant">
      <Text style={s.eyebrow}>{name ? 'YOUR SELECTED RESTAURANT' : 'YOUR MEAL SEARCH'}</Text>
      <Text style={s.name}>{name ?? 'Meals for your goals'}</Text>
      <Text style={s.badge}>Full menus with Pro</Text>
      {(intent.query || intent.areaName) && <Text style={s.search}>{[intent.query, intent.areaName].filter(Boolean).join(' · ')}</Text>}
      {targets && <View style={s.targets}><Text style={s.note}>Your meal targets</Text><Text style={s.note}>{targets.calories} kcal · {targets.protein}g protein · {targets.carbs}g carbs · {targets.fat}g fat</Text></View>}
    </View>
    <View style={s.reassurance}><Ionicons name="checkmark" size={19} color={EDITORIAL.greenAccent} /><Text style={s.reassuranceText}>Your search and targets stay with you.</Text></View>
  </View>;
}
const s = StyleSheet.create({
  wrap: { gap: 18 },
  card: { padding: 22, borderRadius: 24, gap: 16, backgroundColor: EDITORIAL.greenAccentTint },
  eyebrow: { ...TEXT.caption, color: EDITORIAL.greenAccent, fontSize: 10, letterSpacing: 1 },
  name: { ...TEXT.title, fontSize: 27, lineHeight: 32 },
  badge: { ...TEXT.bodySmall, alignSelf: 'flex-start', color: EDITORIAL.green, borderWidth: 1, borderColor: EDITORIAL.greenAccentTint, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7 },
  search: { ...TEXT.body, borderTopWidth: 1, borderColor: EDITORIAL.border, paddingTop: 16 },
  targets: { gap: 9 },
  note: { ...TEXT.bodySmall, color: EDITORIAL.textMid },
  reassurance: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  reassuranceText: { ...TEXT.bodySmall, color: EDITORIAL.greenAccent, flexShrink: 1 },
});
