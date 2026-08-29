import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { RestaurantCard, SkeletonCard } from '@/components/PreviewRestaurantCard';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { prefetchedRestaurants } from '@/lib/teaserCache';
import { fetchPreviewRestaurants, type PreviewRestaurant } from '@/lib/previewSearch';
import { FALLBACK_LAT, FALLBACK_LNG } from '@/lib/useLocation';
import { trackOnboardingScreenView, trackPreviewFetchFailed } from '@/lib/analytics';

export default function ResultsScreen() {
  const [restaurants, setRestaurants] = useState<PreviewRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState(false);
  // Silver Lake sample shown in place of the (real) teaser when the user's own
  // area comes back empty — see the showEmpty effect below.
  const [sample, setSample] = useState<PreviewRestaurant[] | null>(null);

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

  // The user's own area came back empty — explicit Silver Lake coords (not
  // theirs, which is what returned zero results) so the teaser still shows
  // real, working cards, clearly labeled as a sample rather than "near you."
  // Fetches once; a failure just falls back to the plain empty-state copy.
  useEffect(() => {
    if (!showEmpty || sample !== null) return;
    let active = true;
    fetchPreviewRestaurants({ lat: FALLBACK_LAT, lng: FALLBACK_LNG })
      .then((data) => {
        if (active) setSample(data);
      })
      .catch(() => {
        if (active) setSample([]);
      });
    return () => {
      active = false;
    };
  }, [showEmpty, sample]);

  const showSampleSkeletons = showEmpty && sample === null;
  const showSample = showEmpty && sample !== null && sample.length > 0;
  const showSampleUnavailable = showEmpty && sample !== null && sample.length === 0;

  return (
    <WelcomeScreen
      progress={17 / 18}
      title={showEmpty ? "We're not in your area yet" : 'Restaurants that fit your macros.'}
      subtitle={
        showEmpty
          ? 'Fitsy is launching in Los Angeles first — your city is next on the list.'
          : 'These spots near you have meals that match your targets.'
      }
      onContinue={() =>
        router.push({
          pathname: '/welcome/signin',
          params: showEmpty ? { outOfArea: '1' } : {},
        })
      }
      canContinue
      continueLabel={showEmpty ? 'Keep me posted' : 'Continue'}
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
          <Text style={s.sampleLabel}>
            A sample from Silver Lake, LA — not restaurants near you
          </Text>
        )}

        {showSampleSkeletons &&
          [0, 1, 2].map((i) => <SkeletonCard key={i} delay={i * 60} />)
        }

        {showSample &&
          sample!.slice(0, 3).map((r, i) => (
            <RestaurantCard key={r.id} restaurant={r} delay={i * 80} />
          ))
        }

        {showSampleUnavailable && (
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

  emptyWrap: { alignItems: 'center', paddingVertical: 32 },
  emptyTxt: { fontFamily: FONTS.nunitoSans, fontSize: 16, color: EDITORIAL.textSoft, textAlign: 'center' },

  sampleLabel: {
    fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '700',
    color: EDITORIAL.textSoft, textTransform: 'uppercase', letterSpacing: 0.5,
    textAlign: 'center', marginBottom: 2,
  },

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
