import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RestaurantResult } from '@fitsy/shared';
import { FitsyLoader } from '@/components/FitsyLoader';
import { FilterPopup } from '@/components/FilterPopup';
import { LocationPickerSheet } from '@/components/LocationPickerSheet';
import type { MacroValues } from '@/lib/macroPresets';
import { fetchRestaurantsPage } from '@/lib/apiClient';
import { useLocation, type LocationState } from '@/lib/useLocation';
import type { PresetLocation } from '@/lib/locations';
import { getMacroTargets, saveMacroTargets } from '@/lib/macroStorage';
import { EDITORIAL, FONTS } from '@/lib/brand';
import {
  trackCuisineSelected,
  trackLocationManualOverrideCleared,
  trackLocationManualOverrideOpened,
  trackLocationManualOverridePicked,
  trackMacroTargetsEdited,
  trackRestaurantTapped,
  trackSaveMacroTargetsFailed,
  trackSearchEmptyResults,
  trackSearchFailed,
  trackSearchPerformed,
  trackSearchPageLoaded,
  trackSearchPaginationEndReached,
} from '@/lib/analytics';

const DEBOUNCE_MS = 600;
const { width: SCREEN_W } = Dimensions.get('window');
const HERO_H = 320;
const DISH_CARD_W = SCREEN_W * 0.44;
const DISH_CARD_H = 138;

// ─── Cuisine filters ──────────────────────────────────────────────────────────

const CUISINE_FILTERS = [
  { id: 'all', label: 'All', icon: 'grid-outline' },
  { id: 'asian', label: 'Asian', icon: 'restaurant-outline' },
  { id: 'mexican', label: 'Mexican', icon: 'flame-outline' },
  { id: 'healthy', label: 'Healthy', icon: 'leaf-outline' },
  { id: 'fast_food', label: 'Fast Food', icon: 'fast-food-outline' },
  { id: 'vegan', label: 'Vegan', icon: 'nutrition-outline' },
] as const;

// ─── Dietary badge labels ─────────────────────────────────────────────────────

const DIETARY_BADGE_LABELS: Record<string, string> = {
  has_vegan: 'VEGAN',
  has_vegetarian: 'VEG',
  'has_gluten-free': 'GF',
  has_keto: 'KETO',
  'has_dairy-free': 'DF',
};

// ─── Mock images + fallback data ──────────────────────────────────────────────

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

const MOCK_RESULTS: RestaurantResult[] = [
  { id: 'mock-1', name: 'Evergreen Kitchen', address: '1424 Sunset Blvd, Silver Lake', lat: 34.0875, lng: -118.2604, distanceMiles: 0.4, cuisineTags: ['healthy', 'bowls'], chainFlag: false, photoUrl: MOCK_IMAGES[0]!, bestMatch: { name: 'Seared Ahi Bowl', calories: 482, proteinG: 42, carbsG: 38, fatG: 14, matchScore: 0.02, confidence: 'HIGH', menuItemId: 'mock-mi-1' } },
  { id: 'mock-2', name: 'The Iron Grill', address: '3302 Glendale Blvd', lat: 34.0922, lng: -118.2587, distanceMiles: 1.2, cuisineTags: ['american', 'fast_food'], chainFlag: true, photoUrl: MOCK_IMAGES[2]!, bestMatch: { name: 'Double Smash Burger', calories: 620, proteinG: 48, carbsG: 32, fatG: 28, matchScore: 0.12, confidence: 'MEDIUM', menuItemId: 'mock-mi-2' } },
  { id: 'mock-3', name: 'Mesa Verde', address: '2100 Echo Park Ave', lat: 34.0781, lng: -118.2606, distanceMiles: 1.8, cuisineTags: ['mexican'], chainFlag: false, photoUrl: MOCK_IMAGES[4]!, bestMatch: { name: 'Chicken Burrito Bowl', calories: 610, proteinG: 45, carbsG: 52, fatG: 18, matchScore: 0.22, confidence: 'HIGH', menuItemId: 'mock-mi-3' } },
  { id: 'mock-4', name: 'Harvest Market', address: '890 Hyperion Ave', lat: 34.0955, lng: -118.2732, distanceMiles: 0.9, cuisineTags: ['healthy', 'vegan'], chainFlag: false, photoUrl: MOCK_IMAGES[5]!, bestMatch: { name: 'Power Greens Salad', calories: 320, proteinG: 28, carbsG: 18, fatG: 16, matchScore: 0.08, confidence: 'HIGH', menuItemId: 'mock-mi-4' } },
  { id: 'mock-5', name: 'Sakura Ramen', address: '4501 Melrose Ave', lat: 34.0835, lng: -118.3100, distanceMiles: 2.0, cuisineTags: ['asian', 'japanese'], chainFlag: false, photoUrl: MOCK_IMAGES[3]!, bestMatch: { name: 'Chicken Teriyaki Bowl', calories: 580, proteinG: 40, carbsG: 65, fatG: 14, matchScore: 0.30, confidence: 'HIGH', menuItemId: 'mock-mi-5' } },
];

const DEFAULT_INPUTS: MacroValues = { protein: '', carbs: '', fat: '', calories: '' };

// ─── Masthead ─────────────────────────────────────────────────────────────────

function getSelectionLabel(): string {
  const hour = new Date().getHours();
  if (hour < 11) return 'THE MORNING SELECTION';
  if (hour < 17) return 'THE MIDDAY SELECTION';
  return 'THE EVENING SELECTION';
}

function Masthead({
  locationLabel,
  onLocationPress,
}: {
  locationLabel: string;
  onLocationPress: () => void;
}) {
  return (
    <View style={s.masthead}>
      <View style={s.mastheadTop}>
        <View style={s.logoRow}>
          <View style={s.logoDot} />
          <Text style={s.logo}>fitsy</Text>
        </View>
        <TouchableOpacity
          style={s.locationChip}
          onPress={onLocationPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Location: ${locationLabel}`}
          accessibilityHint="Double-tap to change location"
        >
          <Ionicons name="location" size={11} color={EDITORIAL.greenAccent} />
          <Text style={s.locationText}>{locationLabel}</Text>
          <Ionicons name="chevron-down" size={10} color={EDITORIAL.textSoft} />
        </TouchableOpacity>
      </View>
      <Text style={s.issueLabel}>{getSelectionLabel()}</Text>
    </View>
  );
}

// ─── Macro strip ──────────────────────────────────────────────────────────────

function MacroStrip({ macros, onEdit }: { macros: MacroValues; onEdit: () => void }) {
  const p = macros.protein || '—';
  const c = macros.carbs || '—';
  const f = macros.fat || '—';
  const protein = parseFloat(macros.protein) || 0;
  const carbs = parseFloat(macros.carbs) || 0;
  const fat = parseFloat(macros.fat) || 0;
  const cal = protein + carbs + fat > 0 ? String(Math.round(protein * 4 + carbs * 4 + fat * 9)) : '—';

  return (
    <View style={s.macroStrip}>
      <View style={s.macroItem}>
        <Text style={s.macroVal}>{p}g</Text>
        <Text style={s.macroLbl}>protein</Text>
      </View>
      <View style={s.macroDivider} />
      <View style={s.macroItem}>
        <Text style={s.macroVal}>{c}g</Text>
        <Text style={s.macroLbl}>carbs</Text>
      </View>
      <View style={s.macroDivider} />
      <View style={s.macroItem}>
        <Text style={s.macroVal}>{f}g</Text>
        <Text style={s.macroLbl}>fat</Text>
      </View>
      <View style={s.macroDivider} />
      <View style={s.macroItem}>
        <Text style={s.macroVal}>{cal}</Text>
        <Text style={s.macroLbl}>kcal/meal</Text>
      </View>
      <TouchableOpacity
        style={s.editBtn}
        onPress={onEdit}
        activeOpacity={0.7}
        accessibilityLabel="Edit macro targets"
        accessibilityRole="button"
      >
        <Text style={s.editBtnText}>Edit</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Cuisine chips ────────────────────────────────────────────────────────────

function CuisineRow({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
      {CUISINE_FILTERS.map((f) => {
        const active = f.id === selected;
        return (
          <TouchableOpacity
            key={f.id}
            style={[s.filterBubble, active && s.filterBubbleActive]}
            onPress={() => onSelect(f.id)}
            activeOpacity={0.7}
            accessibilityLabel={`Filter by ${f.label}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Ionicons name={f.icon as any} size={15} color={active ? EDITORIAL.cream : EDITORIAL.textSoft} />
            <Text style={[s.filterLabel, active && s.filterLabelActive]}>{f.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ─── Dietary badges ──────────────────────────────────────────────────────────

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

// ─── Hero card (#01) ──────────────────────────────────────────────────────────

function HeroCard({ result }: { result: RestaurantResult }) {
  const bm = result.bestMatch;
  const imgUri = result.photoUrl || getMockImage(result.name);
  return (
    <TouchableOpacity
      activeOpacity={0.92}
      style={hero.container}
      onPress={() => {
        trackRestaurantTapped({
          restaurant_id: result.id,
          restaurant_name: result.name,
          position: 0,
          entry_point: 'hero',
          best_match_calories: result.bestMatch?.calories,
        });
        router.push({
          pathname: `/restaurant/${result.id}`,
          params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl, cuisine: result.cuisineTags?.[0] },
        });
      }}
      accessibilityLabel={`${result.name}${result.bestMatch ? `, best match: ${result.bestMatch.name}` : ''}`}
      accessibilityRole="button"
    >
      <Image source={{ uri: imgUri }} style={hero.image} resizeMode="cover" />
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
        {bm && <Text style={hero.dishName} numberOfLines={1}>{bm.name}</Text>}
        {bm && (
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
      </View>
    </TouchableOpacity>
  );
}

// ─── Dish carousel card ───────────────────────────────────────────────────────

function DishCard({ result, onPress }: { result: RestaurantResult; onPress?: () => void }) {
  const bm = result.bestMatch;
  const imgUri = result.photoUrl || getMockImage(result.name);
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      style={dc.container}
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
      <Image source={{ uri: imgUri }} style={dc.image} resizeMode="cover" />
      <LinearGradient colors={['transparent', EDITORIAL.cardGrad]} style={dc.gradient} />
      <View style={dc.info}>
        {bm && <Text style={dc.dishName} numberOfLines={2}>{bm.name}</Text>}
        {bm && <Text style={dc.cal}>{bm.calories} kcal · P {bm.proteinG}g · C {bm.carbsG}g · F {bm.fatG}g</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ─── Numbered restaurant section (#02+) ──────────────────────────────────────

function RestaurantSection({ result, index }: { result: RestaurantResult; index: number }) {
  const indexStr = String(index + 2).padStart(2, '0');
  const position = index + 1;

  function navigateToRestaurant() {
    router.push({
      pathname: `/restaurant/${result.id}`,
      params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl, cuisine: result.cuisineTags?.[0] },
    });
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
      activeOpacity={0.85}
      onPress={handleSectionPress}
      accessibilityLabel={`${result.name}, view full menu`}
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
      <DishCard result={result} onPress={handleDishCardPress} />
      {result.bestMatch && (
        <Text style={s.viewMenu}>View full menu →</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const [inputs, setInputs] = useState<MacroValues>(DEFAULT_INPUTS);
  const [results, setResults] = useState<RestaurantResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialFetch = useRef(true);
  const [filterVisible, setFilterVisible] = useState(false);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [cuisineFilter, setCuisineFilter] = useState('all');

  // `pagesLoadedRef` counts how many pages have been appended (initial + each
  // onEndReached append). We track it on a ref so the value is current inside
  // async callbacks without forcing a re-render. `isLoadingMoreRef` is the
  // double-fire guard for onEndReached — FlatList will fire it repeatedly while
  // the fetch is in flight if we don't lock.
  const pagesLoadedRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  // Track whether we've already emitted `search_pagination_end_reached` for
  // the current search so we don't fire it on every subsequent re-render once
  // nextCursor flips to null.
  const endReachedFiredRef = useRef(false);

  const location = useLocation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleOpenLocationPicker() {
    trackLocationManualOverrideOpened();
    setLocationPickerVisible(true);
  }

  function handlePickLocation(loc: PresetLocation) {
    trackLocationManualOverridePicked({ neighborhood: loc.name });
    // Fire-and-forget — useLocation updates state synchronously, so we don't
    // need to await SecureStore.setItemAsync before the search re-fires.
    location.setManualLocation(loc).catch(() => {});
  }

  function handleUseCurrentLocation() {
    trackLocationManualOverrideCleared();
    location.clearManualLocation().catch(() => {});
  }

  const hasInputs =
    inputs.protein !== '' || inputs.carbs !== '' || inputs.fat !== '' || inputs.calories !== '';

  // Load saved macro targets before initial fetch.
  // Single useFocusEffect (mount + every tab focus) with a value-equality
  // check so unchanged targets don't bump the inputs identity and re-trigger
  // the fetch effect.
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  useFocusEffect(
    useCallback(() => {
      getMacroTargets()
        .then((saved) => {
          if (saved) {
            setInputs((prev) =>
              prev.protein === saved.protein &&
              prev.carbs === saved.carbs &&
              prev.fat === saved.fat &&
              prev.calories === saved.calories
                ? prev
                : saved,
            );
          }
        })
        .catch((err: unknown) => {
          // Loading saved targets is non-critical (the user can re-enter via
          // the Edit panel) so don't block the screen, but a silent failure
          // here previously hid AsyncStorage corruption from us. Surface it
          // in dev console at minimum.
          // eslint-disable-next-line no-console
          console.warn('[search] getMacroTargets failed:', err);
        })
        .finally(() => setTargetsLoaded(true));
    }, []),
  );

  // Build the query params shared between the first-page fetch and the
  // onEndReached page-N fetch. The cursor is the only difference.
  const buildParams = useCallback(
    (
      current: MacroValues,
      lat: number,
      lng: number,
      cuisine: string,
    ): Parameters<typeof fetchRestaurantsPage>[0] => {
      const params: Parameters<typeof fetchRestaurantsPage>[0] = { lat, lng };
      const protein = parseFloat(current.protein);
      const carbs = parseFloat(current.carbs);
      const fat = parseFloat(current.fat);
      const calories = parseFloat(current.calories);

      if (!isNaN(protein)) params.protein = protein;
      if (!isNaN(carbs)) params.carbs = carbs;
      if (!isNaN(fat)) params.fat = fat;
      if (!isNaN(calories)) params.calories = calories;
      if (cuisine !== 'all') params.cuisineType = cuisine;
      return params;
    },
    [],
  );

  const doFetch = useCallback(
    async (
      current: MacroValues,
      lat: number,
      lng: number,
      cuisine: string,
      locationSource: LocationState['source'],
    ) => {
      setLoading(true);
      setError(null);
      // New search → reset pagination bookkeeping.
      pagesLoadedRef.current = 0;
      isLoadingMoreRef.current = false;
      endReachedFiredRef.current = false;
      setNextCursor(null);

      const params = buildParams(current, lat, lng, cuisine);
      const protein = parseFloat(current.protein);
      const carbs = parseFloat(current.carbs);
      const fat = parseFloat(current.fat);
      const calories = parseFloat(current.calories);

      try {
        const { data, nextCursor: cursor } = await fetchRestaurantsPage(params);
        setResults(data);
        setNextCursor(cursor);
        pagesLoadedRef.current = 1;
        trackSearchPageLoaded({
          page_index: 0,
          result_count: data.length,
          cursor: null,
        });
        if (cursor === null) {
          endReachedFiredRef.current = true;
          trackSearchPaginationEndReached({
            total_results: data.length,
            pages_loaded: 1,
          });
        }
        trackSearchPerformed({
          has_protein_target: !isNaN(protein),
          has_carbs_target: !isNaN(carbs),
          has_fat_target: !isNaN(fat),
          has_calories_target: !isNaN(calories),
          cuisine_filter: cuisine,
          result_count: data.length,
          location_source: locationSource,
          success: true,
        });
        if (data.length === 0) {
          // Distinct from `search_failed` (network) and from "no inputs"
          // (which never reaches this code path because the effect skips
          // the fetch). This is the "filter returned zero" branch — useful
          // for tracking when user-set macro/cuisine combos exclude the
          // entire catalog.
          trackSearchEmptyResults({
            cuisine_filter: cuisine,
            has_protein_target: !isNaN(protein),
            has_carbs_target: !isNaN(carbs),
            has_fat_target: !isNaN(fat),
            has_calories_target: !isNaN(calories),
          });
        }
      } catch (err) {
        setResults([]);
        setNextCursor(null);
        trackSearchPerformed({
          has_protein_target: !isNaN(protein),
          has_carbs_target: !isNaN(carbs),
          has_fat_target: !isNaN(fat),
          has_calories_target: !isNaN(calories),
          cuisine_filter: cuisine,
          result_count: 0,
          location_source: locationSource,
          success: false,
        });
        trackSearchFailed({
          cuisine_filter: cuisine,
          error_message: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setLoading(false);
      }
    },
    [buildParams],
  );

  // onEndReached handler — fires when the user scrolls within
  // `onEndReachedThreshold` of the bottom. Halts silently when nextCursor is
  // null (end of results) or when a load is already in flight.
  const handleEndReached = useCallback(async () => {
    if (!hasInputs) return;
    if (nextCursor === null) return;
    if (isLoadingMoreRef.current) return;

    isLoadingMoreRef.current = true;
    setLoadingMore(true);

    const cursorBeingFetched = nextCursor;
    const pageIndex = pagesLoadedRef.current;
    const params = buildParams(inputs, location.lat, location.lng, cuisineFilter);
    params.cursor = cursorBeingFetched;

    try {
      const { data, nextCursor: cursor } = await fetchRestaurantsPage(params);

      // Dedupe on id — defends against a server-side equal-distance edge case
      // where a row could (in principle) overlap the cursor boundary. Cheap
      // and defensive.
      setResults((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        const merged = [...prev];
        for (const r of data) {
          if (!seen.has(r.id)) {
            merged.push(r);
            seen.add(r.id);
          }
        }
        return merged;
      });
      setNextCursor(cursor);
      pagesLoadedRef.current = pageIndex + 1;

      trackSearchPageLoaded({
        page_index: pageIndex,
        result_count: data.length,
        cursor: cursorBeingFetched,
      });

      if (cursor === null && !endReachedFiredRef.current) {
        endReachedFiredRef.current = true;
        // Defer reading the running total: setResults runs before us in the
        // microtask queue, but reading state synchronously here would still
        // be stale. The total_results for this event is computed from
        // prev.length + data.length captured here.
        setResults((prev) => {
          trackSearchPaginationEndReached({
            total_results: prev.length,
            pages_loaded: pagesLoadedRef.current,
          });
          return prev;
        });
      }
    } catch {
      // Silent — the next scroll will retry. Don't surface a banner here:
      // the user already has a populated list and a transient page-N error
      // shouldn't disrupt browsing.
    } finally {
      isLoadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [
    buildParams,
    cuisineFilter,
    hasInputs,
    inputs,
    location.lat,
    location.lng,
    nextCursor,
  ]);

  useEffect(() => {
    if (!targetsLoaded || location.loading) return;
    if (!hasInputs) { setLoading(false); return; }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const locSource: LocationState['source'] = location.source;

    if (initialFetch.current) {
      initialFetch.current = false;
      doFetch(inputs, location.lat, location.lng, cuisineFilter, locSource);
      return;
    }

    debounceRef.current = setTimeout(() => {
      doFetch(inputs, location.lat, location.lng, cuisineFilter, locSource);
    }, DEBOUNCE_MS);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputs, location.lat, location.lng, location.loading, cuisineFilter, doFetch, targetsLoaded]);

  const persistMacroTargets = useCallback((values: MacroValues) => {
    saveMacroTargets(values).catch((err: unknown) => {
      // Previously a silent catch — users thought their targets saved when
      // they hadn't, then opened the app the next day to a fresh-install
      // experience. Surface a retry dialog + fire a PostHog event so we can
      // see how often this happens and trigger the retry path manually.
      // eslint-disable-next-line no-console
      console.warn('[search] saveMacroTargets failed:', err);
      trackSaveMacroTargetsFailed(err);
      Alert.alert(
        "Couldn't save targets",
        "We couldn't save your macro targets. Check your connection and try again.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Retry',
            onPress: () => persistMacroTargets(values),
          },
        ],
      );
    });
  }, []);

  function handleApplyFilters(newValues: MacroValues) {
    setFilterVisible(false);
    setInputs(newValues);
    persistMacroTargets(newValues);
    trackMacroTargetsEdited({
      entry_point: 'search',
      has_protein: newValues.protein !== '',
      has_carbs: newValues.carbs !== '',
      has_fat: newValues.fat !== '',
      has_calories: newValues.calories !== '',
    });
  }

  function handleCuisineSelect(id: string) {
    setCuisineFilter(id);
    trackCuisineSelected({ cuisine: id });
  }

  const locationLabel = location.loading
    ? 'Locating...'
    : location.source === 'gps'
      ? 'Near You'
      : location.source === 'manual'
        ? location.name ?? 'Manual'
        : 'Silver Lake, LA';

  const [heroResult, ...listResults] = results;

  // The header bundles all non-paginated chrome — masthead, macro strip,
  // cuisine row, hero card, and inline empty states. FlatList renders it
  // once at the top and only the `listResults` tail virtualizes/paginates.
  const renderHeader = useCallback(() => (
    <>
      <Masthead locationLabel={locationLabel} onLocationPress={handleOpenLocationPicker} />
      <MacroStrip macros={inputs} onEdit={() => setFilterVisible(true)} />
      <CuisineRow selected={cuisineFilter} onSelect={handleCuisineSelect} />

      {!hasInputs && (
        <View style={s.inlineEmpty}>
          <Ionicons name="nutrition-outline" size={32} color={EDITORIAL.greenAccent} />
          <Text style={s.inlineEmptyText}>Set your macro targets</Text>
          <Text style={s.inlineEmptyHint}>Tap Edit above to enter your protein, carb, fat, and calorie goals</Text>
        </View>
      )}

      {hasInputs && results.length === 0 && (
        <View style={s.inlineEmpty}>
          <Ionicons name="search-outline" size={32} color={EDITORIAL.creamDeep} />
          <Text style={s.inlineEmptyText}>No restaurants match this filter</Text>
          <Text style={s.inlineEmptyHint}>Try adjusting your macros or cuisine</Text>
        </View>
      )}

      {hasInputs && heroResult && <HeroCard result={heroResult} />}
    </>
  ), [cuisineFilter, hasInputs, heroResult, inputs, locationLabel, results.length]);

  // Footer is the loading spinner during onEndReached fetches. When
  // nextCursor is null (no more pages) the footer renders nothing — per
  // spec, we halt silently with no terminal label.
  const renderFooter = useCallback(() => {
    if (!loadingMore) return null;
    return (
      <View style={s.footerSpinner}>
        <ActivityIndicator size="small" color={EDITORIAL.greenAccent} />
      </View>
    );
  }, [loadingMore]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: EDITORIAL.cream }}>
      {loading && (
        <View style={s.loaderWrap}>
          <FitsyLoader size="md" />
        </View>
      )}
      {!loading && error !== null && (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}
      {!loading && (
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
          data={hasInputs ? listResults : []}
          keyExtractor={(r) => r.id}
          renderItem={({ item, index }) => (
            <RestaurantSection result={item} index={index} />
          )}
          ListHeaderComponent={renderHeader}
          ListFooterComponent={renderFooter}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
        />
      )}
      <FilterPopup
        visible={filterVisible}
        values={inputs}
        onApply={handleApplyFilters}
        onClose={() => setFilterVisible(false)}
      />
      <LocationPickerSheet
        visible={locationPickerVisible}
        activeName={location.source === 'manual' ? location.name : undefined}
        onPick={(loc) => {
          handlePickLocation(loc);
          setLocationPickerVisible(false);
        }}
        onUseCurrent={() => {
          handleUseCurrentLocation();
          setLocationPickerVisible(false);
        }}
        onClose={() => setLocationPickerVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  masthead: {
    backgroundColor: EDITORIAL.cream,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  mastheadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  logoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: EDITORIAL.green },
  logo: {
    fontSize: 24,
    fontFamily: FONTS.frauncesDisplayBold,
    color: EDITORIAL.green,
    letterSpacing: -0.6,
  },
  locationChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: EDITORIAL.creamCard, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: EDITORIAL.border,
  },
  locationText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '600', color: EDITORIAL.textSoft },
  issueLabel: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 10, fontWeight: '700', color: EDITORIAL.textSoft,
    letterSpacing: 2.5, textTransform: 'uppercase',
  },

  macroStrip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 10, borderWidth: 1, borderColor: EDITORIAL.border,
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  macroItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1 },
  macroVal: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, lineHeight: 13, color: EDITORIAL.text },
  macroLbl: { fontFamily: FONTS.nunitoSans, fontSize: 8, lineHeight: 10, color: EDITORIAL.textSoft, letterSpacing: 0.3 },
  macroDivider: { width: 1, height: 18, backgroundColor: EDITORIAL.creamDeep },
  editBtn: {
    backgroundColor: EDITORIAL.green, borderRadius: 6,
    paddingHorizontal: 9, paddingVertical: 5, marginLeft: 6,
  },
  editBtnText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 10, color: EDITORIAL.cream, letterSpacing: 0.2 },

  filterRow: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 7 },
  filterBubble: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 18, borderWidth: 1, borderColor: EDITORIAL.border,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  filterBubbleActive: { backgroundColor: EDITORIAL.green, borderColor: EDITORIAL.green },
  filterLabel: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 12, fontWeight: '600', color: EDITORIAL.textSoft },
  filterLabelActive: { color: EDITORIAL.cream },

  restSection: { marginTop: 22 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'baseline', gap: 10,
    paddingHorizontal: 20, marginBottom: 10,
  },
  sectionIndex: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 20, color: EDITORIAL.textSoft,
    lineHeight: 24, letterSpacing: -0.5,
    minWidth: 24,
  },
  sectionTitleBlock: { flex: 1 },
  sectionRestName: {
    fontFamily: FONTS.frauncesDisplayBold,
    fontSize: 20, color: EDITORIAL.text, letterSpacing: -0.5, lineHeight: 24,
  },
  sectionSub: { fontFamily: FONTS.nunitoSans, fontSize: 11, fontWeight: '500', color: EDITORIAL.textSoft, marginTop: 2 },
  viewMenu: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 12, fontWeight: '600', color: EDITORIAL.greenAccent, paddingHorizontal: 20, marginTop: 6 },

  inlineEmpty: { alignItems: 'center', paddingTop: 50, paddingBottom: 30, gap: 8 },
  inlineEmptyText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 15, fontWeight: '600', color: EDITORIAL.textSoft },
  inlineEmptyHint: { fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.textSoft, textAlign: 'center', lineHeight: 20 },
  footerSpinner: { paddingVertical: 24, alignItems: 'center', justifyContent: 'center' },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBanner: {
    marginHorizontal: 16, marginTop: 16, borderRadius: 8, padding: 12,
    backgroundColor: '#FEF2F2',
  },
  errorText: { fontFamily: FONTS.nunitoSans, fontSize: 14, textAlign: 'center', color: '#DC2626' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontFamily: FONTS.nunitoSans, fontSize: 16, fontWeight: '500', color: EDITORIAL.textSoft },
});

const hero = StyleSheet.create({
  container: {
    height: HERO_H,
    marginHorizontal: 16,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: EDITORIAL.creamDeep,
    marginTop: 4,
  },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: HERO_H * 0.75 },
  overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, gap: 4 },
  topRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6,
  },
  indexBadge: {
    backgroundColor: 'rgba(253,251,247,0.22)', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  indexText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '800', color: 'rgba(253,251,247,0.95)', letterSpacing: 0.5 },
  badgeRow: { flexDirection: 'row', gap: 4 },
  badge: {
    backgroundColor: 'rgba(253,251,247,0.18)', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  badgeText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 9, fontWeight: '700', color: 'rgba(253,251,247,0.9)', letterSpacing: 1 },
  distText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '600', color: 'rgba(253,251,247,0.65)', marginLeft: 'auto' },
  restName: {
    // Heavier display cut on the photo overlay — the 450 weight reads thin
    // against busy hero images, so use the 600 we already bake for splashes.
    fontFamily: FONTS.frauncesDisplayBold,
    fontSize: 28, color: EDITORIAL.cream, letterSpacing: -0.8, lineHeight: 32,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  dishName: {
    // Italic serif gives the editorial accent the webapp uses for the dish.
    fontFamily: FONTS.newsreaderItalic,
    fontSize: 17, color: 'rgba(253,251,247,0.92)', letterSpacing: -0.2,
    fontStyle: 'italic',
  },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  macroText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '600', color: 'rgba(253,251,247,0.6)' },
  dot: { fontFamily: FONTS.nunitoSans, fontSize: 11, color: 'rgba(253,251,247,0.3)' },
  calText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 11, fontWeight: '700', color: 'rgba(253,251,247,0.88)' },
});

const dc = StyleSheet.create({
  container: {
    height: DISH_CARD_H, borderRadius: 16, overflow: 'hidden',
    backgroundColor: EDITORIAL.creamDeep,
    marginHorizontal: 16,
  },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: DISH_CARD_H * 0.9 },
  info: { position: 'absolute', bottom: 12, left: 14, right: 14 },
  dishName: {
    // Heavier display cut + slight shadow so dish copy stays readable against
    // busy food photos.
    fontFamily: FONTS.frauncesDisplayBold,
    fontSize: 16, color: EDITORIAL.cream, letterSpacing: -0.3, lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  cal: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 11, color: 'rgba(253,251,247,0.85)', marginTop: 3,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
