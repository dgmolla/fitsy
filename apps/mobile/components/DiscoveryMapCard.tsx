import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { RestaurantResult } from '@fitsy/shared';
import { EDITORIAL } from '@/lib/brand';
import { RestaurantPhoto } from './RestaurantPhoto';
import { hero } from './DiscoveryScreen.styles';
import { HeroMealContent, mealAccessibilitySummary } from './DiscoveryCards';

// Reuse Search's main-photo, gradient and editorial overlay treatment.
export function DiscoveryMapCard({ result, locked, onPress, label, testID, style, page, pageTestID }: {
  result: RestaurantResult; locked: boolean; onPress: () => void; label: string; testID: string;
  style?: StyleProp<ViewStyle>; page?: string; pageTestID?: string;
}) {
  return <Pressable style={[s.card, style]} testID={testID} onPress={onPress}
    accessibilityRole="button" accessibilityLabel={`${label}${mealAccessibilitySummary(result, locked)}`}>
    <RestaurantPhoto uri={result.photoUrl} name={result.name} style={hero.image} />
    <LinearGradient colors={['transparent', EDITORIAL.heroGrad]} style={StyleSheet.absoluteFill} />
    <View style={[hero.overlay, s.copy]}>
      <HeroMealContent result={result} locked={locked} nameStyle={s.name} />
      <View style={s.footer}>
        <Text style={s.link}>View menu →</Text>
        {page && <Text style={s.detail} testID={pageTestID}>{page}</Text>}
      </View>
    </View>
  </Pressable>;
}

const s = StyleSheet.create({
  card: { height: 180, borderRadius: 24, overflow: 'hidden', backgroundColor: EDITORIAL.green },
  copy: { padding: 16, gap: 4 },
  name: { fontSize: 24, lineHeight: 28 },
  detail: { ...hero.macroText, color: 'rgba(253,251,247,0.9)', fontSize: 12, lineHeight: 17 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  link: { ...hero.calText, color: EDITORIAL.cream, fontSize: 13, lineHeight: 18 },
});
