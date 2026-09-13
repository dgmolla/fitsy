import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { RestaurantResult } from '@fitsy/shared';
import { EDITORIAL } from '@/lib/brand';
import { BlurFallback } from '@/lib/BlurFallback';
import { hasUsedPreviewSample, routeToPaywall } from '@/lib/teaserGate';
import { trackRestaurantTapped } from '@/lib/analytics';
import { RestaurantPhoto } from './RestaurantPhoto';
import { s, hero, dc } from './DiscoveryScreen.styles';

const DIETARY_BADGE_LABELS: Record<string, string> = {
  has_vegan: 'VEGAN',
  has_vegetarian: 'VEG',
  'has_gluten-free': 'GF',
  has_keto: 'KETO',
  'has_dairy-free': 'DF',
};

function DietaryBadges({ options }: { options?: string[] }) {
  if (!options || options.length === 0) return null;
  const badges = options.map((o) => DIETARY_BADGE_LABELS[o]).filter(Boolean) as string[];
  if (badges.length === 0) return null;
  return (
    <View style={hero.badgeRow}>
      {badges.slice(0, 2).map((b) => (
        <View key={b} style={hero.badge}>
          <Text style={hero.badgeText}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Locked dish teaser ───────────────────────────────────────────────────────

// Shown in place of the real dish name/macros when the caller isn't
// entitled (`meta.locked`). The API never sends the real bestMatch in that
// case, so this is greeked placeholder content under a blur, not real data -
// the lock is enforced server-side, this is just the visual for it.
function LockedDishTeaser({ variant }: { variant: 'hero' | 'card' }) {
  const wrap = variant === 'hero' ? hero.lockedWrap : dc.lockedWrap;
  const barWide = variant === 'hero' ? hero.lockedBarWide : dc.lockedBarWide;
  const barNarrow = variant === 'hero' ? hero.lockedBarNarrow : dc.lockedBarNarrow;
  return (
    <View style={wrap}>
      <View style={barWide} />
      <View style={barNarrow} />
      <BlurFallback
        tint="light"
        intensity={35}
        fallbackColor="rgba(253,251,247,0.4)"
        style={StyleSheet.absoluteFillObject as ViewStyle}
      />
    </View>
  );
}

// Top-3 rows stay tappable while locked, but the free detail look is once
// per onboarding pass: once it's spent, a tap goes to the paywall instead of
// opening another (truncated) menu. Unlocked rows always just navigate.
// `opening` guards a fast double-tap from pushing two detail screens while
// the (cached, usually instant) flag read is still a microtask away.
let opening = false;
async function openRestaurantOrPaywall(
  locked: boolean,
  navigate: () => void,
  unlocking?: () => void,
): Promise<void> {
  if (opening) return;
  opening = true;
  try {
    if (locked && unlocking) {
      // Entitled but the rows are still locked (server row lagging a
      // purchase): the paywall is the wrong place, re-sync instead.
      unlocking();
      return;
    }
    if (locked && (await hasUsedPreviewSample())) {
      await routeToPaywall();
      return;
    }
    navigate();
  } finally {
    opening = false;
  }
}

// ─── Hero card (#01) ──────────────────────────────────────────────────────────

export function HeroCard({ result, locked, unlocking, containerRef, onOpen }: { result: RestaurantResult; locked: boolean; unlocking?: () => void; containerRef?: React.RefObject<View | null>; onOpen?: () => void }) {
  const bm = result.bestMatch;
  return (
    <View ref={containerRef} collapsable={false} testID="preview-pick-1">
    <TouchableOpacity
      activeOpacity={0.92}
      style={hero.container}
      testID="discovery-hero"
      onPress={() => {
        trackRestaurantTapped({
          restaurant_id: result.id,
          restaurant_name: result.name,
          position: 0,
          entry_point: 'hero',
          best_match_calories: result.bestMatch?.calories,
        });
        if (onOpen) { onOpen(); return; }
        void openRestaurantOrPaywall(locked, () => router.push({
          pathname: `/restaurant/${result.id}`,
          params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl, cuisine: result.cuisineTags?.[0] },
        }), unlocking);
      }}
      accessibilityLabel={`${result.name}${result.bestMatch ? `, best match: ${result.bestMatch.name}` : ''}`}
      accessibilityRole="button"
    >
      <RestaurantPhoto identifyRestaurant uri={result.photoUrl} name={result.name} style={hero.image} />
      <LinearGradient
        colors={['transparent', EDITORIAL.heroGrad]}
        style={hero.gradient}
      />
      <View style={hero.overlay}>
        <View style={hero.topRow}>
          <View style={hero.indexBadge}>
            <Text style={hero.indexText}>01</Text>
          </View>
          <DietaryBadges options={result.dietaryOptions} />
          <Text style={hero.distText}>{result.distanceMiles?.toFixed(1)} mi</Text>
        </View>
        <Text style={hero.restName} numberOfLines={1}>{result.name}</Text>
        {locked && <LockedDishTeaser variant="hero" />}
        {!locked && bm && <Text style={hero.dishName} numberOfLines={2}>{bm.name}</Text>}
        {!locked && bm && (
          <View style={hero.macroRow}>
            <Text style={hero.macroText}>P {bm.proteinG}g</Text>
            <Text style={hero.dot}>·</Text>
            <Text style={hero.macroText}>C {bm.carbsG}g</Text>
            <Text style={hero.dot}>·</Text>
            <Text style={hero.macroText}>F {bm.fatG}g</Text>
            <Text style={hero.dot}>·</Text>
            <Text style={hero.calText}>{bm.calories} kcal</Text>
          </View>
        )}
        {!locked && bm && <Text style={hero.macroText}>{bm.nutritionBasis === 'published' ? 'Published nutrition' : bm.nutritionBasis === 'estimated' ? 'Estimated nutrition' : 'Nutrition information'}</Text>}
        {onOpen && <Text style={hero.macroText}>See full menu with Pro →</Text>}
      </View>
    </TouchableOpacity>
    </View>
  );
}

// ─── Dish carousel card ───────────────────────────────────────────────────────

function DishCard({ result, locked, onPress }: { result: RestaurantResult; locked: boolean; onPress?: () => void }) {
  const bm = result.bestMatch;
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      style={dc.container}
      testID={`discovery-dish-${result.id}`}
      onPress={() => {
        if (onPress) {
          onPress();
        } else {
          router.push({
            pathname: `/restaurant/${result.id}`,
            params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl, cuisine: result.cuisineTags?.[0] },
          });
        }
      }}
      accessibilityLabel={result.bestMatch ? `${result.bestMatch.name} at ${result.name}` : result.name}
      accessibilityRole="button"
    >
      <RestaurantPhoto identifyRestaurant uri={result.photoUrl} name={result.name} style={dc.image} />
      <LinearGradient colors={['transparent', EDITORIAL.cardGrad]} style={dc.gradient} />
      <View style={dc.info}>
        {locked && <LockedDishTeaser variant="card" />}
        {!locked && bm && <Text style={dc.dishName} numberOfLines={2}>{bm.name}</Text>}
        {!locked && bm && <Text style={dc.cal}>{bm.calories} kcal · P {bm.proteinG}g · C {bm.carbsG}g · F {bm.fatG}g</Text>}
        {!locked && bm && <Text style={dc.cal}>{bm.nutritionBasis === 'published' ? 'Published nutrition' : bm.nutritionBasis === 'estimated' ? 'Estimated nutrition' : 'Nutrition information'}</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ─── Numbered restaurant section (#02+) ──────────────────────────────────────

export function RestaurantSection({ result, index, locked, unlocking, onOpen }: { result: RestaurantResult; index: number; locked: boolean; unlocking?: () => void; onOpen?: () => void }) {
  const indexStr = String(index + 2).padStart(2, '0');
  const position = index + 1;

  function navigateToRestaurant() {
    if (onOpen) { onOpen(); return; }
    void openRestaurantOrPaywall(locked, () => router.push({
      pathname: `/restaurant/${result.id}`,
      params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl, cuisine: result.cuisineTags?.[0] },
    }), unlocking);
  }

  function handleSectionPress() {
    trackRestaurantTapped({
      restaurant_id: result.id,
      restaurant_name: result.name,
      position,
      entry_point: 'section',
      best_match_calories: result.bestMatch?.calories,
    });
    navigateToRestaurant();
  }

  function handleDishCardPress() {
    trackRestaurantTapped({
      restaurant_id: result.id,
      restaurant_name: result.name,
      position,
      entry_point: 'dish_card',
      best_match_calories: result.bestMatch?.calories,
    });
    navigateToRestaurant();
  }

  return (
    <TouchableOpacity
      style={s.restSection}
      testID={`preview-pick-${index + 2}`}
      activeOpacity={0.85}
      onPress={handleSectionPress}
      accessibilityLabel={`${result.name}, ${onOpen ? 'see full menu with Pro' : 'view full menu'}`}
      accessibilityRole="button"
    >
      <View style={s.sectionHeader}>
        <Text style={s.sectionIndex}>{indexStr}</Text>
        <View style={s.sectionTitleBlock}>
          <Text style={s.sectionRestName} numberOfLines={1}>{result.name}</Text>
          <Text style={s.sectionSub}>
            {result.distanceMiles?.toFixed(1)} mi
            {result.priceLevel ? ` · ${result.priceLevel}` : ''}
            {result.rating ? ` · ★${result.rating.toFixed(1)}` : ''}
          </Text>
        </View>
      </View>
      <DishCard result={result} locked={locked} onPress={handleDishCardPress} />
      {!locked && result.bestMatch && (
        <Text style={s.viewMenu}>{onOpen ? 'See full menu with Pro →' : 'View full menu →'}</Text>
      )}
    </TouchableOpacity>
  );
}

