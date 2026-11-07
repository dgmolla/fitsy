import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { RestaurantResult } from '@fitsy/shared';
import { EDITORIAL } from '@/lib/brand';
import { RestaurantPhoto } from './RestaurantPhoto';
import { hero } from './DiscoveryScreen.styles';
import { HeroMealContent } from './DiscoveryCards';

// Reuse Search's main-photo, gradient and editorial overlay treatment.
export function DiscoveryMapCard({ result, locked, onPress, label, testID, style, peek = false, page, pageTestID }: {
  result: RestaurantResult; locked: boolean; onPress: () => void; label: string; testID: string;
  style?: StyleProp<ViewStyle>; peek?: boolean; page?: string; pageTestID?: string;
}) {
  return <Pressable style={[s.card, peek && s.peek, style]} testID={testID} onPress={onPress}
    accessibilityRole="button" accessibilityLabel={`${label}${!locked && result.bestMatch ? `, best match: ${result.bestMatch.name}, ${result.bestMatch.calories} kcal` : ''}`}>
    <RestaurantPhoto uri={result.photoUrl} name={result.name} style={hero.image} />
    <LinearGradient colors={['transparent', EDITORIAL.heroGrad]} style={StyleSheet.absoluteFill} />
    <View style={[hero.overlay, s.copy, peek && s.peekCopy]}>
      <HeroMealContent result={result} locked={locked} nameStyle={[s.name, peek && s.peekName]} dishStyle={peek && s.peekDish} />
      {!peek && <View style={s.footer}>
        <Text style={s.link}>View menu →</Text>
        {page && <Text style={s.detail} testID={pageTestID}>{page}</Text>}
      </View>}
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
  peek: { height: 96, borderRadius: 16 },
  peekCopy: { paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  peekName: { fontSize: 20, lineHeight: 24 },
  peekDish: { fontSize: 14, lineHeight: 17 },
});
