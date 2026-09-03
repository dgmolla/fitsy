import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { RestaurantCard, SkeletonCard } from '@/components/PreviewRestaurantCard';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { usePurchases } from '@/lib/usePurchases';
import { fetchPreviewRestaurants, type PreviewRestaurant } from '@/lib/previewSearch';
import { openLegalLink } from '@/lib/legalLinks';

/**
 * Shown instead of the search tab when a signed-in user's Fitsy Pro
 * entitlement has LAPSED (RevenueCat has a past record of it, but it isn't
 * active now) — as opposed to a user who never subscribed, who sees the
 * regular inline paywall card on the search tab instead. See app/index.tsx
 * for the routing decision and lib/purchases.ts `hasLapsedEntitlement`.
 *
 * Deliberately avoids "free trial" language: Apple won't grant a second free
 * trial to the same Apple ID, so promising one here (like the first-time
 * paywall does) would be misleading and can end in a confusing full-price
 * charge with no explanation.
 */
export default function ResubscribeScreen() {
  const { offering, refreshOffering, purchase, restore } = usePurchases();
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // A locked teaser of what resubscribing unlocks, same cards + fetch as the
  // onboarding teaser (welcome/results.tsx). A fetch failure just hides the
  // section — this is illustrative, not required to resubscribe.
  const [restaurants, setRestaurants] = useState<PreviewRestaurant[]>([]);
  const [teaserLoading, setTeaserLoading] = useState(true);

  useEffect(() => {
    fetchPreviewRestaurants()
      .then(setRestaurants)
      .catch(() => setRestaurants([]))
      .finally(() => setTeaserLoading(false));
  }, []);

  // Retry the boot-time offering fetch when arriving without one (see payment.tsx).
  useEffect(() => {
    if (!offering) void refreshOffering();
  }, [offering, refreshOffering]);

  const annualPrice = offering?.annual?.product.priceString ?? '$39.99/yr';

  async function handleResubscribe() {
    const annual = offering?.annual ?? (await refreshOffering())?.annual;
    if (!annual) {
      Alert.alert('Just a moment', 'Plans are still loading — please try again.');
      return;
    }
    setLoading(true);
    try {
      const isPro = await purchase(annual, 'resubscribe');
      if (isPro) router.replace('/(tabs)/search');
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      const isPro = await restore();
      if (isPro) {
        router.replace('/(tabs)/search');
      } else {
        Alert.alert('Nothing to restore', "We couldn't find an active subscription for this account.");
      }
    } finally {
      setRestoring(false);
    }
  }

  return (
    <WelcomeScreen
      title={'Welcome back.'}
      subtitle="Your Fitsy Pro subscription ended. Resubscribe to keep finding restaurants that fit your macros."
      onContinue={handleResubscribe}
      canContinue={!loading}
      continueLabel={loading ? 'Resubscribing…' : `Resubscribe — ${annualPrice}/yr`}
      // Declining resubscribe still gets the locked search teaser (real
      // browsing, blurred macro-match data) rather than a dead end - same
      // mechanic as a first-time visitor who hasn't paid yet.
      onSkip={() => router.replace('/(tabs)/search?preview=1')}
      showBack={false}
    >
      {(teaserLoading || restaurants.length > 0) && (
        <View style={s.teaserWrap}>
          <View style={s.teaserList}>
            {teaserLoading &&
              [0, 1].map((i) => <SkeletonCard key={i} delay={i * 60} />)}
            {!teaserLoading &&
              restaurants.slice(0, 2).map((r, i) => (
                <RestaurantCard key={r.id} restaurant={r} delay={i * 80} />
              ))}
          </View>
          <View style={s.lockOverlay} pointerEvents="none">
            <View style={s.lockBadge}>
              <Ionicons name="lock-closed" size={20} color={EDITORIAL.cream} />
            </View>
          </View>
        </View>
      )}

      <Pressable
        style={s.restore}
        onPress={handleRestore}
        disabled={restoring}
        accessibilityRole="button"
      >
        <Text style={s.restoreTxt}>{restoring ? 'Restoring…' : 'Restore purchases'}</Text>
      </Pressable>

      <Text style={s.disclosure}>
        Fitsy Pro is an auto-renewing subscription ({annualPrice}). Payment is charged to your
        Apple ID at confirmation. It renews automatically unless cancelled at least 24 hours
        before the period ends. Manage or cancel in your App Store account settings.
      </Text>
      <View style={s.legalRow}>
        <Pressable hitSlop={8} onPress={() => openLegalLink('terms')} accessibilityRole="link">
          <Text style={s.legalLink}>Terms of Use</Text>
        </Pressable>
        <Text style={s.legalDot}>·</Text>
        <Pressable hitSlop={8} onPress={() => openLegalLink('privacy')} accessibilityRole="link">
          <Text style={s.legalLink}>Privacy Policy</Text>
        </Pressable>
      </View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  teaserWrap: { position: 'relative', marginBottom: 20 },
  teaserList: { gap: 10 },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  restore: { alignItems: 'center', paddingVertical: 10, marginBottom: 8 },
  restoreTxt: { fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.textSoft },
  disclosure: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 11,
    lineHeight: 16,
    color: EDITORIAL.textSoft,
    textAlign: 'center',
    marginBottom: 10,
  },
  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  legalLink: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 12, fontWeight: '600', color: EDITORIAL.textMid },
  legalDot: { color: EDITORIAL.textSoft, fontSize: 12 },
});
