import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';

interface LockedUnlockCardProps {
  /** Headline, e.g. "+12 more dishes". */
  title: string;
  /** One-line pitch under the headline. */
  subtitle: string;
  onPress: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The dark "there's more behind the lock" card shared by the locked
 * restaurant detail (after the free sample of dishes) and the locked search
 * results (after the three open restaurants). One tap = the paywall entry
 * point for whoever is looking (see lib/teaserGate routeToPaywall).
 */
export function LockedUnlockCard({ title, subtitle, onPress, accessibilityLabel, style }: LockedUnlockCardProps) {
  return (
    <Pressable
      style={({ pressed }) => [s.card, pressed && s.pressed, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={s.icon}>
        <Ionicons name="lock-closed" size={18} color={EDITORIAL.cream} />
      </View>
      <Text style={s.title}>{title}</Text>
      <Text style={s.subtitle}>{subtitle}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    marginHorizontal: 18, marginTop: 8, marginBottom: 12,
    backgroundColor: EDITORIAL.text, borderRadius: 16,
    paddingVertical: 22, paddingHorizontal: 20,
    alignItems: 'center', gap: 4,
  },
  pressed: { opacity: 0.9 },
  icon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: EDITORIAL.greenAccent,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  title: { fontFamily: FONTS.frauncesDisplay, fontSize: 18, color: EDITORIAL.cream },
  subtitle: { fontFamily: FONTS.nunitoSans, fontSize: 12.5, color: 'rgba(253,251,247,0.7)', textAlign: 'center', lineHeight: 18, marginTop: 2 },
});
