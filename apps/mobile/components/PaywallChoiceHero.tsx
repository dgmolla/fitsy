import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { RestaurantPhoto } from './RestaurantPhoto';
import { EDITORIAL, FONTS } from '@/lib/brand';
import type { PaywallDiscovery, PaywallRestaurant } from '@/lib/usePaywallDiscovery';

function Photo({ restaurant, selected = false }: { restaurant: PaywallRestaurant; selected?: boolean }) {
  return <View style={s.photo}>
    <RestaurantPhoto uri={restaurant.photoUrl} name={restaurant.name} style={s.image} />
    <View style={s.caption}><Text style={s.captionText} numberOfLines={2} testID={selected ? 'paywall-selected-restaurant' : undefined}>{selected ? `Your pick · ${restaurant.name}` : 'Nearby'}</Text></View>
  </View>;
}
export function PaywallChoiceHero({ discovery }: { discovery: PaywallDiscovery }) {
  const { height, fontScale } = useWindowDimensions();
  const { selected, nearby, additionalCount } = discovery;
  const hasCount = additionalCount != null && additionalCount > 0;
  const primary = selected ?? nearby[0];
  const others = selected ? nearby : nearby.slice(1);
  const meals = additionalCount === 1 ? 'meal' : 'meals';
  const menu = selected ? `Explore ${selected.name}’s full menu` : 'Explore full restaurant menus';
  return <View>
    <Text style={s.title}>Your goals.{'\n'}A lot more choice.</Text>
    <Text style={s.subtitle}>{hasCount ? `${menu} and ${additionalCount.toLocaleString()} more ${meals} close to your targets.` : `${menu}. Find more ways to eat toward your goals.`}</Text>
    {primary && <View style={[s.mosaic, { height: Math.max(130, Math.min(158, height * 0.18)) }]} testID="paywall-meal-image">
      <View style={s.primary}><Photo restaurant={primary} selected={!!selected} /></View>
      {others.length > 0 && <View style={s.side}>{others.slice(0, 2).map(r => <Photo key={r.id} restaurant={r} />)}</View>}
    </View>}
    {hasCount && <View style={[s.proof, fontScale > 1.35 && s.proofLarge]} testID="paywall-local-proof" accessible accessibilityLabel={`${additionalCount.toLocaleString()} more ${meals} close to your targets`}>
      <Text style={s.count} testID="paywall-matching-count">+{additionalCount.toLocaleString()}</Text>
      <Text style={s.proofLabel}>more {meals} close to{ '\n' }your meal targets</Text>
    </View>}
    {hasCount && <Text style={s.nutritionNote}>Matches use published or estimated nutrition.</Text>}
  </View>;
}
const s = StyleSheet.create({
  title: { fontFamily: FONTS.frauncesDisplay, fontSize: 34, lineHeight: 37, letterSpacing: -0.8, color: EDITORIAL.green },
  subtitle: { fontFamily: FONTS.nunitoSans, fontSize: 14, lineHeight: 20, color: EDITORIAL.textMid, marginTop: 12, marginBottom: 18 },
  mosaic: { flexDirection: 'row', gap: 9, marginBottom: 8 },
  primary: { flex: 1.65 },
  side: { flex: 1, gap: 8 },
  photo: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: EDITORIAL.creamDeep },
  image: { height: '100%', width: '100%' },
  caption: { position: 'absolute', bottom: 7, left: 7, right: 7, alignItems: 'flex-start' },
  captionText: { backgroundColor: EDITORIAL.cream, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4, fontFamily: FONTS.nunitoSansSemiBold, fontSize: 10, lineHeight: 13, color: EDITORIAL.green },
  proof: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  nutritionNote: { fontFamily: FONTS.nunitoSans, fontSize: 10, lineHeight: 14, color: EDITORIAL.textMid, marginBottom: 16 },
  proofLarge: { flexDirection: 'column', alignItems: 'flex-start' },
  count: { fontFamily: FONTS.frauncesDisplay, fontSize: 32, lineHeight: 40, color: EDITORIAL.green, flexShrink: 1 },
  proofLabel: { flexShrink: 1, fontFamily: FONTS.nunitoSans, fontSize: 12, lineHeight: 17, color: EDITORIAL.textMid },
});
