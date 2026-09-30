import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DISHES } from '@/lib/dishImages';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { HeroCard } from './DiscoveryCards';
import type { PaywallDiscovery } from '@/lib/usePaywallDiscovery';

/** Welcome imagery continues across the upper screen behind the real preview. */
export function PaywallMosaic({ height }: { height: number }) {
  return <View pointerEvents="none" style={[s.mosaic, { height }]} testID="paywall-mosaic" accessible={false} importantForAccessibility="no-hide-descendants">
    {DISHES.slice(0, 15).map((source, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      return <Image key={index} source={source} style={[s.tile, {
        left: `${column * 34 - 1}%`, top: row * 91 - (column === 1 ? 44 : 12),
        transform: [{ rotate: column === 1 ? '3deg' : '-3deg' }],
      }]} resizeMode="cover" />;
    })}
    <LinearGradient colors={['rgba(253,251,247,0.64)', 'rgba(253,251,247,0.84)', EDITORIAL.cream]} locations={[0, 0.58, 1]} style={StyleSheet.absoluteFillObject} />
  </View>;
}

/** Restaurant identity and photo are sourced from the selection or live catalog. */
export function PaywallHero({ discovery, compact = false }: { discovery: PaywallDiscovery; compact?: boolean }) {
  const restaurant = discovery.selected;
  return <View style={[s.frame, compact && s.frameCompact]} testID="paywall-hero">
    {restaurant ? <><HeroCard result={restaurant} locked={false} paywallPreview />
      {discovery.catalogFallback && <Text style={s.fallback}>A meal from the local catalog</Text>}</>
      : <View style={[s.card, s.empty]} testID="paywall-restaurant-unavailable">
      <Text style={s.eyebrow}>{discovery.loading ? 'FINDING YOUR PREVIEW' : 'EXPLORE WITH FITSY'}</Text>
      <Text style={s.detail}>{discovery.loading ? 'Loading a restaurant from your preview…' : 'Discover restaurants in Los Angeles'}</Text>
    </View>}
  </View>;
}

const s = StyleSheet.create({
  mosaic: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden', backgroundColor: EDITORIAL.cream },
  tile: { position: 'absolute', width: '32%', height: 112, borderRadius: 9 },
  frame: { marginTop: 19, marginBottom: 8, paddingHorizontal: 22 },
  frameCompact: { marginTop: 18, marginBottom: 8 },
  card: { minHeight: 106, flexDirection: 'row', overflow: 'hidden', borderRadius: 18, backgroundColor: EDITORIAL.cream, borderWidth: 1, borderColor: EDITORIAL.border, shadowColor: EDITORIAL.green, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.16, shadowRadius: 14, elevation: 4 },
  photoFrame: { width: 102, alignSelf: 'stretch', overflow: 'hidden' },
  photo: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  info: { flex: 1, minWidth: 0, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 9 },
  eyebrow: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 9, letterSpacing: 1, color: EDITORIAL.textMid },
  name: { fontFamily: FONTS.frauncesDisplayBold, fontSize: 19, lineHeight: 24, color: EDITORIAL.green, marginTop: 3 },
  detail: { fontFamily: FONTS.nunitoSans, fontSize: 11, lineHeight: 15, color: EDITORIAL.textMid, marginTop: 3 },
  empty: { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 12 },
  fallback: { fontFamily: FONTS.nunitoSans, fontSize: 10, color: EDITORIAL.textMid, textAlign: 'center', marginTop: 2 },
});
