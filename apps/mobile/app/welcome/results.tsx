import React, { useCallback, useEffect, useState } from 'react';
import { ImageBackground, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { prefetchedRestaurants } from '@/lib/teaserCache';
import { fetchPreviewRestaurants, type PreviewRestaurant } from '@/lib/previewSearch';
import { trackOnboardingScreenView, trackPreviewFetchFailed } from '@/lib/analytics';

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

export default function ResultsScreen() {
  const [restaurants, setRestaurants] = useState<PreviewRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState(false);

  useEffect(() => {
    trackOnboardingScreenView('results');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);

    // Use prefetched data from finding screen if available
    if (prefetchedRestaurants.data && prefetchedRestaurants.data.length > 0) {
      setRestaurants(prefetchedRestaurants.data);
      setNetworkError(false);
      setLoading(false);
      return;
    }

    // If the finding-screen prefetch errored, render the network-error state
    // immediately rather than re-fetching here — the results screen renders
    // ~2s after `finding` resolved, so a fresh attempt is unlikely to succeed
    // and the extra wait makes the failure feel slower. The retry button
    // covers the case where the user's connectivity recovers.
    if (prefetchedRestaurants.error) {
      setRestaurants([]);
      setNetworkError(true);
      setLoading(false);
      return;
    }

    // Fallback: fetch directly (e.g. user navigated back to this screen).
    try {
      const data = await fetchPreviewRestaurants();
      setRestaurants(data);
      setNetworkError(false);
      prefetchedRestaurants.data = data;
      prefetchedRestaurants.error = false;
    } catch (err) {
      setRestaurants([]);
      setNetworkError(true);
      prefetchedRestaurants.error = true;
      // eslint-disable-next-line no-console
      console.warn('[results] preview fetch failed:', err);
      trackPreviewFetchFailed(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showSkeletons = loading;
  const showError = !loading && networkError;
  const showRestaurants = !loading && !networkError && restaurants.length > 0;
  const showEmpty = !loading && !networkError && restaurants.length === 0;

  return (
    <WelcomeScreen
      progress={14 / 15}
      title="Restaurants that fit your macros."
      subtitle="These spots near you have meals that match your targets."
      onContinue={() => router.push('/welcome/signin')}
      canContinue
      continueLabel="Continue"
    >
      <View style={s.list}>
        {showSkeletons &&
          [0, 1, 2].map((i) => <SkeletonCard key={i} delay={i * 60} />)
        }

        {showRestaurants &&
          restaurants.slice(0, 3).map((r, i) => (
            <RestaurantCard key={r.id} restaurant={r} delay={i * 80} />
          ))
        }

        {showError && (
          <Animated.View entering={FadeInDown.duration(400)} style={s.errorWrap}>
            <Text style={s.errorTitle}>Network problem</Text>
            <Text style={s.errorTxt}>
              We couldn't reach Fitsy. Check your connection and try again.
            </Text>
            <TouchableOpacity
              style={s.retryBtn}
              onPress={load}
              activeOpacity={0.85}
              accessibilityLabel="Retry loading restaurants"
              accessibilityRole="button"
            >
              <Text style={s.retryTxt}>Retry</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {showEmpty && (
          <Animated.View entering={FadeInDown.duration(400)} style={s.emptyWrap}>
            <Text style={s.emptyTxt}>We're still adding restaurants in your area.</Text>
          </Animated.View>
        )}
      </View>

      <Animated.View
        entering={FadeInDown.duration(400).delay(500)}
        style={s.callout}
      >
        <Text style={s.calloutEmoji}>🔓</Text>
        <Text style={s.calloutTxt}>
          Subscribe to see exactly which meals at each spot fit your macros.
        </Text>
      </Animated.View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  list: { gap: 10, marginBottom: 24 },

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

  emptyWrap: { alignItems: 'center', paddingVertical: 32 },
  emptyTxt: { fontFamily: FONTS.nunitoSans, fontSize: 16, color: EDITORIAL.textSoft, textAlign: 'center' },

  errorWrap: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
    gap: 10,
    backgroundColor: EDITORIAL.creamDeep,
    borderRadius: 14,
  },
  errorTitle: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 18,
    color: EDITORIAL.text,
    letterSpacing: -0.3,
  },
  errorTxt: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 14,
    color: EDITORIAL.textSoft,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 6,
    backgroundColor: EDITORIAL.text,
    borderRadius: 10,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  retryTxt: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 14,
    fontWeight: '700',
    color: EDITORIAL.cream,
    letterSpacing: 0.2,
  },

  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: EDITORIAL.creamDeep,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  calloutEmoji: { fontFamily: FONTS.nunitoSans, fontSize: 18, lineHeight: 22 },
  calloutTxt: {
    fontFamily: FONTS.nunitoSans,
    flex: 1,
    fontSize: 13,
    color: EDITORIAL.text,
    lineHeight: 19,
  },
});
