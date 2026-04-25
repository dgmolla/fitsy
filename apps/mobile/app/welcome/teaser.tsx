import React, { useEffect, useState } from 'react';
import { ImageBackground, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { FALLBACK_LAT, FALLBACK_LNG } from '@/lib/useLocation';
import { api } from '@/lib/api';

const CARD_H = 112;

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

interface PreviewRestaurant {
  id: string;
  name: string;
  cuisineTags: string[];
  distanceMiles: number;
  photoUrl?: string;
}

interface PreviewResponse {
  data: PreviewRestaurant[];
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
  // UberEats CDN requires Referer header or it returns 403
  if (uri.includes('uber.com')) {
    return { uri, headers: { Referer: 'https://www.ubereats.com' } };
  }
  return { uri };
}

function RestaurantCard({ restaurant, delay }: { restaurant: PreviewRestaurant; delay: number }) {
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
            <View style={s.lockedPill}>
              <Text style={s.lockedPillTxt}>🔒 meals that fit your macros</Text>
            </View>
          </View>
        </View>
      </ImageBackground>
    </Animated.View>
  );
}

function SkeletonCard({ delay }: { delay: number }) {
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

export default function TeaserScreen() {
  const [restaurants, setRestaurants] = useState<PreviewRestaurant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const params = new URLSearchParams({
          lat: String(FALLBACK_LAT),
          lng: String(FALLBACK_LNG),
        });
        const res = await api.get<PreviewResponse>(`/api/restaurants/preview?${params.toString()}`);
        setRestaurants(res.data);
      } catch {
        // Fall back to visually-rich mock cards so the teaser is never blank
        setRestaurants([
          { id: 'm1', name: 'Sweetgreen', cuisineTags: ['salads', 'healthy'], distanceMiles: 0.4, photoUrl: MOCK_IMAGES[0]! },
          { id: 'm2', name: 'Chipotle', cuisineTags: ['mexican'], distanceMiles: 0.9, photoUrl: MOCK_IMAGES[1]! },
        ]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const showSkeletons = loading;
  const showRestaurants = !loading && restaurants.length > 0;
  const showEmpty = !loading && restaurants.length === 0;

  return (
    <WelcomeScreen
      progress={1 / 16}
      title="We find restaurants with meals that hit your targets."
      subtitle="Tell us a few things about you, and we'll match you to spots near you."
      onContinue={() => router.push('/welcome/tried')}
      onBack={() => router.back()}
      canContinue
      continueLabel="Continue"
    >
      <View style={s.list}>
        {showSkeletons &&
          [0, 1].map((i) => <SkeletonCard key={i} delay={i * 60} />)
        }

        {showRestaurants &&
          restaurants.slice(0, 2).map((r, i) => (
            <RestaurantCard key={r.id} restaurant={r} delay={i * 80} />
          ))
        }

        {showEmpty && (
          <Animated.View entering={FadeInDown.duration(400)} style={s.emptyWrap}>
            <Text style={s.emptyTxt}>Ready to find your restaurants.</Text>
          </Animated.View>
        )}
      </View>

      <Animated.View
        entering={FadeInDown.duration(400).delay(500)}
        style={s.callout}
      >
        <Text style={s.calloutEmoji}>✨</Text>
        <Text style={s.calloutTxt}>
          Once we know your goals, we'll show you exactly which meals at each spot fit your macros.
        </Text>
      </Animated.View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  list: { gap: 10, marginBottom: 24 },

  // Image card
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
  chipTxt: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.9)', letterSpacing: 0.2 },
  distTxt: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  cardBottom: { gap: 6 },
  cardName: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 18,
    color: '#fff',
    letterSpacing: -0.4,
  },
  lockedPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lockedPillTxt: { fontSize: 11, color: 'rgba(255,255,255,0.8)', letterSpacing: 0.1 },

  // Skeleton card
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

  emptyWrap: { alignItems: 'center', paddingVertical: 32 },
  emptyTxt: { fontSize: 16, color: EDITORIAL.textSoft, textAlign: 'center' },

  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: EDITORIAL.creamDeep,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  calloutEmoji: { fontSize: 18, lineHeight: 22 },
  calloutTxt: {
    flex: 1,
    fontSize: 13,
    color: EDITORIAL.text,
    lineHeight: 19,
  },
});
