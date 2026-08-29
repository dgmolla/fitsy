import React from 'react';
import { ImageBackground, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { EDITORIAL, FONTS } from '@/lib/brand';
import type { PreviewRestaurant } from '@/lib/previewSearch';

// Shared between welcome/results.tsx (the "restaurants near you" teaser) and
// welcome/out-of-area.tsx (the Silver Lake sample shown to out-of-area users)
// so both render identical restaurant cards from `fetchPreviewRestaurants`.
//
// Deliberately NOT in components/index.ts: the barrel already exports an
// unrelated `RestaurantCard` (the full search-tab card over `RestaurantResult`
// from @fitsy/shared, with match badges). Import this one directly from
// '@/components/PreviewRestaurantCard' to avoid the name collision.

export const CARD_H = 112;

const MOCK_IMAGES = [
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=70',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=70',
  'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=800&q=70',
  'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=70',
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=70',
  'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&q=70',
];

function getMockImage(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MOCK_IMAGES[h % MOCK_IMAGES.length]!;
}

function formatCuisine(tags: string[]): string {
  if (tags.length === 0) return 'Restaurant';
  const tag = tags[0]!;
  return tag.charAt(0).toUpperCase() + tag.slice(1).replace(/_/g, ' ');
}

function formatDistance(miles: number): string {
  return miles < 0.1 ? 'Nearby' : `${miles.toFixed(1)} mi`;
}

function imageSource(uri: string) {
  if (uri.includes('uber.com')) {
    return { uri, headers: { Referer: 'https://www.ubereats.com' } };
  }
  return { uri };
}

export function RestaurantCard({ restaurant, delay }: { restaurant: PreviewRestaurant; delay: number }) {
  const [imgUri, setImgUri] = React.useState(
    restaurant.photoUrl || getMockImage(restaurant.name),
  );
  return (
    <Animated.View entering={FadeInDown.duration(400).delay(delay)}>
      <ImageBackground
        source={imageSource(imgUri)}
        style={s.card}
        imageStyle={s.cardImageStyle}
        resizeMode="cover"
        onError={() => setImgUri(getMockImage(restaurant.name))}
      >
        <LinearGradient
          colors={['transparent', EDITORIAL.cardGrad]}
          style={s.cardGradient}
        />
        <View style={s.cardOverlay}>
          <View style={s.cardTopRow}>
            <View style={s.chip}>
              <Text style={s.chipTxt}>{formatCuisine(restaurant.cuisineTags)}</Text>
            </View>
            <Text style={s.distTxt}>{formatDistance(restaurant.distanceMiles)}</Text>
          </View>
          <View style={s.cardBottom}>
            <Text style={s.cardName} numberOfLines={1}>{restaurant.name}</Text>
          </View>
        </View>
      </ImageBackground>
    </Animated.View>
  );
}

export function SkeletonCard({ delay }: { delay: number }) {
  return (
    <Animated.View entering={FadeInDown.duration(300).delay(delay)} style={[s.card, s.skelCard]}>
      <View style={s.skelTopRow}>
        <View style={[s.skelPill, { width: 64 }]} />
        <View style={[s.skelPill, { width: 32 }]} />
      </View>
      <View style={[s.skelLine, { width: '55%', position: 'absolute', bottom: 14, left: 14 }]} />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: {
    height: CARD_H,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: EDITORIAL.creamDeep,
  },
  cardImageStyle: { borderRadius: 16 },
  cardGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: CARD_H * 0.75,
  },
  cardOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    bottom: 12,
    justifyContent: 'space-between',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chip: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.9)', letterSpacing: 0.2 },
  distTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  cardBottom: { gap: 6 },
  cardName: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 18,
    color: '#fff',
    letterSpacing: -0.4,
  },

  skelCard: { justifyContent: 'flex-start', padding: 14 },
  skelTopRow: { flexDirection: 'row', justifyContent: 'space-between' },
  skelLine: {
    height: 14,
    backgroundColor: EDITORIAL.creamDeep,
    borderRadius: 6,
  },
  skelPill: {
    height: 20,
    backgroundColor: EDITORIAL.border,
    borderRadius: 6,
  },
});
