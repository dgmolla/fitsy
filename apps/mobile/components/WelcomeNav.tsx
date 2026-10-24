import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL } from '@/lib/brand';

interface Props {
  progress?: number;
  onBack?: () => void;
  backTestID?: string;
  trailing?: React.ReactNode;
}

export function WelcomeNav({ progress, onBack, backTestID = 'welcome-back', trailing }: Props) {
  return <View style={s.bar}>
    {onBack ? <Pressable onPress={onBack} style={s.back} accessibilityRole="button" accessibilityLabel="Go back" testID={backTestID}>
      <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
    </Pressable> : <View style={s.back} />}
    {progress != null && <View style={s.track} accessibilityRole="progressbar" accessibilityLabel="Onboarding progress"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(Math.max(0, Math.min(1, progress)) * 100) }}>
      <View style={[s.fill, { width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }]} />
    </View>}
    {trailing}
  </View>;
}
const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, height: 44, gap: 12 },
  back: { width: 44, height: 44, justifyContent: 'center' },
  track: { flex: 1, height: 3, backgroundColor: EDITORIAL.border, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: EDITORIAL.greenAccent, borderRadius: 2 },
});
