import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RestaurantResult } from '@fitsy/shared';
import { FitsyLoader } from '@/components/FitsyLoader';
import { FilterPopup } from '@/components/FilterPopup';
import { LocationPickerSheet } from '@/components/LocationPickerSheet';
import { BlurFallback } from '@/lib/BlurFallback';
import type { MacroValues } from '@/lib/macroPresets';
import { fetchRestaurantsPage } from '@/lib/apiClient';
import { SubscriptionRequiredError } from '@/lib/api';
import { hasUsedPreviewSample, routeToPaywall } from '@/lib/teaserGate';
import { recordSearchAndMaybePrompt } from '@/lib/ratingPrompt';
import { shouldShowInitialLoader } from '@/lib/searchLoading';
import { useLocation, type LocationState } from '@/lib/useLocation';
import type { PresetLocation } from '@/lib/locations';
import { getMacroTargets, saveMacroTargets } from '@/lib/macroStorage';
import { EDITORIAL, FONTS } from '@/lib/brand';
import {
  trackLocationManualOverrideCleared,
  trackLocationManualOverrideOpened,
  trackLocationManualOverridePicked,
  trackMacroTargetsEdited,
  trackOnboardingScreenView,
  trackPreviewFetchFailed,
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

// ─── Search bar ───────────────────────────────────────────────────────────────

// Persistent horizontal search row. Styled to match the restaurant detail
// screen's menu search input (⌕ glyph + × clear, creamCard pill, see
// app/restaurant/[id].tsx).
function SearchBar({
  value,
  onChangeText,
  onClear,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
}) {
  return (
    <View style={s.search}>
      <Text style={s.searchIco}>⌕</Text>
      <TextInput
        style={s.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search restaurants or dishes"
        placeholderTextColor={EDITORIAL.textSoft}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="never"
        accessibilityLabel="Search restaurants or dishes"
      />
      {value !== '' && (
        <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
          <Text style={s.searchClear}>×</Text>
        </Pressable>
      )}
    </View>
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
async function openRestaurantOrPaywall(locked: boolean, navigate: () => void): Promise<void> {
  if (opening) return;
  opening = true;
  try {
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

function HeroCard({ result, locked }: { result: RestaurantResult; locked: boolean }) {
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
        void openRestaurantOrPaywall(locked, () => router.push({
          pathname: `/restaurant/${result.id}`,
          params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl, cuisine: result.cuisineTags?.[0] },
        }));
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
        {locked && <LockedDishTeaser variant="hero" />}
        {!locked && bm && <Text style={hero.dishName} numberOfLines={1}>{bm.name}</Text>}
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
      </View>
    </TouchableOpacity>
  );
}

// ─── Dish carousel card ───────────────────────────────────────────────────────

function DishCard({ result, locked, onPress }: { result: RestaurantResult; locked: boolean; onPress?: () => void }) {
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
        {locked && <LockedDishTeaser variant="card" />}
        {!locked && bm && <Text style={dc.dishName} numberOfLines={2}>{bm.name}</Text>}
        {!locked && bm && <Text style={dc.cal}>{bm.calories} kcal · P {bm.proteinG}g · C {bm.carbsG}g · F {bm.fatG}g</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ─── Fully-locked restaurant section (#04+) ──────────────────────────────────

// Rows beyond the top 3: the real name/photo/dish ARE rendered - the server
// already sends them (only bestMatch is stripped) - but blurred, so the row
// reads as "something real is here, locked" rather than a blank placeholder.
// The row isn't navigable; tapping it goes straight to the paywall rather
// than a restaurant detail page.
function LockedRestaurantSection({ result, index }: { result: RestaurantResult; index: number }) {
  const indexStr = String(index + 2).padStart(2, '0');
  const imgUri = result.photoUrl || getMockImage(result.name);
  return (
    <Pressable
      style={s.restSection}
      onPress={() => { void routeToPaywall(); }}
      accessibilityLabel="Locked restaurant, subscribe to unlock"
      accessibilityRole="button"
    >
      <View style={s.sectionHeader}>
        <Text style={s.sectionIndex}>{indexStr}</Text>
        <View style={s.lockedNameWrap}>
          <Text style={s.sectionRestName} numberOfLines={1}>{result.name}</Text>
          <Text style={s.sectionSub}>{result.distanceMiles?.toFixed(1)} mi</Text>
          <BlurFallback
            tint="light"
            intensity={40}
            fallbackColor="rgba(253,251,247,0.78)"
            style={StyleSheet.absoluteFillObject as ViewStyle}
          />
        </View>
      </View>
      <View style={dc.container}>
        <Image source={{ uri: imgUri }} style={dc.image} resizeMode="cover" />
        <BlurFallback
          tint="light"
          intensity={50}
          fallbackColor="rgba(232,224,209,0.85)"
          style={StyleSheet.absoluteFillObject as ViewStyle}
        />
        <View style={dc.lockedFullBadgeWrap} pointerEvents="none">
          <View style={dc.lockedFullBadge}>
            <Ionicons name="lock-closed" size={16} color={EDITORIAL.cream} />
          </View>
        </View>
      </View>
      <Text style={s.viewMenu}>Subscribe to unlock →</Text>
    </Pressable>
  );
}

// ─── Numbered restaurant section (#02+) ──────────────────────────────────────

function RestaurantSection({ result, index, locked }: { result: RestaurantResult; index: number; locked: boolean }) {
  const indexStr = String(index + 2).padStart(2, '0');
  const position = index + 1;

  function navigateToRestaurant() {
    void openRestaurantOrPaywall(locked, () => router.push({
      pathname: `/restaurant/${result.id}`,
      params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl, cuisine: result.cuisineTags?.[0] },
    }));
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
      <DishCard result={result} locked={locked} onPress={handleDishCardPress} />
      {!locked && result.bestMatch && (
        <Text style={s.viewMenu}>View full menu →</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SearchScreen() {
  // Present only when entered from the onboarding teaser (welcome/finding.tsx
  // -> `/(tabs)/search?preview=1`) - gates the out-of-area redirect below so a
  // returning lapsed subscriber who just filtered too tight never gets routed
  // into the "not in your area yet" waitlist flow.
  const { preview } = useLocalSearchParams<{ preview?: string }>();
  const isOnboardingPreview = preview === '1';
  // The onboarding teaser's first automatic fetch (macros already set from
  // earlier onboarding steps, no query typed) doubles as the "is this area
  // covered" check the old dedicated results.tsx screen used to run - see
  // outOfAreaCheckedRef usage in doFetch below.
  const outOfAreaCheckedRef = useRef(false);

  // Preserves the old dedicated results.tsx screen's funnel step in the
  // onboarding-screen-view analytics, since this screen now plays that role.
  useEffect(() => {
    if (isOnboardingPreview) trackOnboardingScreenView('results');
  }, [isOnboardingPreview]);

  const [inputs, setInputs] = useState<MacroValues>(DEFAULT_INPUTS);
  const [results, setResults] = useState<RestaurantResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The API never blocks unentitled callers - it returns `meta.locked: true`
  // with bestMatch stripped from every row instead, so this screen doubles as
  // the onboarding + lapsed-subscriber teaser. See RestaurantSection /
  // LockedRestaurantSection for the render split.
  // null until a fetch resolves; false = proven entitled, true = locked.
  const [locked, setLocked] = useState<boolean | null>(null);
  // Set once the onboarding teaser's first confirmed (non-network-error)
  // fetch comes back empty - see outOfAreaCheckedRef in doFetch. Renders an
  // inline choice ("Keep me posted") rather than auto-redirecting, so the
  // user sees the reassurance copy before leaving search.
  const [outOfArea, setOutOfArea] = useState(false);
  const initialFetch = useRef(true);
  const [filterVisible, setFilterVisible] = useState(false);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [query, setQuery] = useState('');

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
  // Set by pull-to-refresh when re-acquiring GPS moves the coordinates: the
  // coordinate change would otherwise re-trigger the search effect below and
  // double-fetch (with a full-screen loader flash) on top of the refresh
  // fetch we fire directly. Consumed-and-cleared on the next effect run.
  const skipLocationFetchRef = useRef(false);

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
  const hasQuery = query.trim() !== '';
  // A search fires when the user has set macro targets OR typed a query. With a
  // query but no macros the API ranks by distance (no macro targets active).
  const canSearch = hasInputs || hasQuery;

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
      q: string,
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
      if (q.trim() !== '') params.query = q.trim();
      return params;
    },
    [],
  );

  const doFetch = useCallback(
    async (
      current: MacroValues,
      lat: number,
      lng: number,
      q: string,
      locationSource: LocationState['source'],
      isRefresh = false,
    ) => {
      // Pull-to-refresh keeps the list mounted and drives the platform
      // RefreshControl spinner; the initial/filter-change fetch shows the
      // full-screen loader (which unmounts the list).
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      setOutOfArea(false);
      // New search → reset pagination bookkeeping.
      pagesLoadedRef.current = 0;
      isLoadingMoreRef.current = false;
      endReachedFiredRef.current = false;
      setNextCursor(null);

      const params = buildParams(current, lat, lng, q);
      const protein = parseFloat(current.protein);
      const carbs = parseFloat(current.carbs);
      const fat = parseFloat(current.fat);
      const calories = parseFloat(current.calories);

      try {
        const { data, nextCursor: cursor, locked: isLocked, networkError } = await fetchRestaurantsPage(params);

        if (networkError) {
          // fetchRestaurantsPage swallows fetch/network failures into a
          // successful-looking `data: []` (so pagination and the general
          // empty state stay simple) - `networkError: true` is the one
          // signal that this wasn't a real "zero matches" response.
          // Surfacing it as an error (not an empty search) matters doubly
          // here: it stops a dropped connection from masquerading as "no
          // matches nearby", and specifically keeps it from tripping the
          // out-of-area check below, which only trusts a *confirmed* empty
          // response.
          setResults([]);
          setNextCursor(null);
          setError('Network problem - check your connection and try again.');
          trackSearchPerformed({
            has_protein_target: !isNaN(protein),
            has_carbs_target: !isNaN(carbs),
            has_fat_target: !isNaN(fat),
            has_calories_target: !isNaN(calories),
            cuisine_filter: 'all',
            query_length: q.trim().length,
            result_count: 0,
            location_source: locationSource,
            success: false,
          });
          trackSearchFailed({ cuisine_filter: 'all', error_message: 'network_error' });
          if (isOnboardingPreview) trackPreviewFetchFailed(new Error('network_error'));
          return;
        }

        // Out-of-area check - mirrors the old dedicated results.tsx screen,
        // which measured this once on load using the macros already set
        // earlier in onboarding. A later edit (user broadens their own
        // filters, or types a query) never re-triggers it - outOfAreaCheckedRef
        // is a one-shot latch set on the first *confirmed* (non-network-error)
        // resolved fetch, so a dropped connection on the very first attempt
        // doesn't consume it - the next real response still gets checked. The
        // auth-gated /api/waitlist join needs a real account, so this hands
        // off to signin (which already carries outOfArea through the rest of
        // onboarding) rather than joining the waitlist directly.
        const isFirstFetch = !outOfAreaCheckedRef.current;
        outOfAreaCheckedRef.current = true;
        if (isOnboardingPreview && isFirstFetch && q.trim() === '' && data.length === 0) {
          setOutOfArea(true);
          setResults([]);
          setNextCursor(null);
          return;
        }

        setResults(data);
        setNextCursor(cursor);
        setLocked(isLocked);
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
          cuisine_filter: 'all',
          query_length: q.trim().length,
          result_count: data.length,
          location_source: locationSource,
          success: true,
        });
        if (data.length === 0) {
          // Distinct from `search_failed` (network) and from "no inputs"
          // (which never reaches this code path because the effect skips
          // the fetch). This is the "filter returned zero" branch — useful
          // for tracking when user-set macro/query combos exclude the
          // entire catalog.
          trackSearchEmptyResults({
            cuisine_filter: 'all',
            has_protein_target: !isNaN(protein),
            has_carbs_target: !isNaN(carbs),
            has_fat_target: !isNaN(fat),
            has_calories_target: !isNaN(calories),
          });
        } else {
          // A successful, non-empty search is an engagement signal — maybe ask
          // for an App Store rating (gated to return sessions, asked once ever).
          void recordSearchAndMaybePrompt();
        }
      } catch (err) {
        // Only SubscriptionRequiredError reaches here (fetchRestaurantsPage
        // resolves every other failure with `networkError: true`, handled
        // above, instead of throwing). /api/restaurants no longer 402s in
        // normal operation - an unentitled caller gets a locked 200 instead -
        // so this is a rare deploy-skew glitch, not a real paywall. Show it
        // as a plain retry-able error rather than force-navigating an
        // entitled user off their in-progress search.
        setResults([]);
        setNextCursor(null);
        setError(
          err instanceof SubscriptionRequiredError
            ? 'Something went wrong. Pull to refresh and try again.'
            : 'Network problem - check your connection and try again.',
        );
        trackSearchPerformed({
          has_protein_target: !isNaN(protein),
          has_carbs_target: !isNaN(carbs),
          has_fat_target: !isNaN(fat),
          has_calories_target: !isNaN(calories),
          cuisine_filter: 'all',
          query_length: q.trim().length,
          result_count: 0,
          location_source: locationSource,
          success: false,
        });
        trackSearchFailed({
          cuisine_filter: 'all',
          error_message: err instanceof Error ? err.message : undefined,
        });
        if (isOnboardingPreview) trackPreviewFetchFailed(err);
      } finally {
        if (isRefresh) setRefreshing(false);
        else setLoading(false);
      }
    },
    [buildParams, isOnboardingPreview],
  );

  // Pull-to-refresh: re-fire a fresh API call against the current location.
  // Resets pagination (handled inside doFetch) so the user gets a clean
  // first page of location-based suggestions. No-op without macro inputs,
  // since there's nothing to query.
  const handleRefresh = useCallback(async () => {
    if (!canSearch) return;
    setRefreshing(true);

    // Re-acquire a fresh GPS fix first so suggestions reflect where the user
    // actually is now. Falls back to the current coordinates when refresh is a
    // no-op (manual override active, permission denied, or a timeout).
    let lat = location.lat;
    let lng = location.lng;
    let source = location.source;
    try {
      const fresh = await location.refreshLocation();
      if (fresh) {
        if (fresh.lat !== location.lat || fresh.lng !== location.lng) {
          // Coordinates moved — suppress the search effect's reaction to the
          // change since we fetch with the fresh coords directly just below.
          skipLocationFetchRef.current = true;
        }
        lat = fresh.lat;
        lng = fresh.lng;
        source = fresh.source;
      }
    } catch {
      // Keep current coordinates — doFetch below still refreshes suggestions.
    }

    await doFetch(inputs, lat, lng, query, source, true);
  }, [
    doFetch,
    canSearch,
    inputs,
    location,
    query,
  ]);

  // onEndReached handler — fires when the user scrolls within
  // `onEndReachedThreshold` of the bottom. Halts silently when nextCursor is
  // null (end of results) or when a load is already in flight.
  const handleEndReached = useCallback(async () => {
    if (!canSearch) return;
    if (nextCursor === null) return;
    if (isLoadingMoreRef.current) return;

    isLoadingMoreRef.current = true;
    setLoadingMore(true);

    const cursorBeingFetched = nextCursor;
    const pageIndex = pagesLoadedRef.current;
    const params = buildParams(inputs, location.lat, location.lng, query);
    params.cursor = cursorBeingFetched;

    try {
      const { data, nextCursor: cursor, locked: isLocked } = await fetchRestaurantsPage(params);

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
      // Entitlement can change mid-session (e.g. a purchase completes while
      // scrolling) - keep `locked` current rather than trusting only the
      // first page's value for every subsequently-loaded row.
      setLocked(isLocked);
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
    query,
    canSearch,
    inputs,
    location.lat,
    location.lng,
    nextCursor,
  ]);

  useEffect(() => {
    // Pull-to-refresh already fetched with the freshly-acquired coordinates;
    // skip the duplicate fetch this coordinate change would otherwise trigger.
    if (skipLocationFetchRef.current) {
      skipLocationFetchRef.current = false;
      return;
    }
    if (!targetsLoaded || location.loading) return;
    if (!canSearch) { setResults([]); setNextCursor(null); setLoading(false); return; }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const locSource: LocationState['source'] = location.source;

    if (initialFetch.current) {
      initialFetch.current = false;
      doFetch(inputs, location.lat, location.lng, query, locSource);
      return;
    }

    debounceRef.current = setTimeout(() => {
      doFetch(inputs, location.lat, location.lng, query, locSource);
    }, DEBOUNCE_MS);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputs, location.lat, location.lng, location.loading, query, canSearch, doFetch, targetsLoaded]);

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

  const handleClearQuery = useCallback(() => setQuery(''), []);

  const handleJoinWaitlist = useCallback(() => {
    router.push('/welcome/signin?outOfArea=1');
  }, []);

  const locationLabel = location.loading
    ? 'Locating...'
    : location.source === 'gps'
      ? 'Near You'
      : location.source === 'manual'
        ? location.name ?? 'Manual'
        : 'Silver Lake, LA';

  const [heroResult, ...listResults] = results;

  // The header bundles the non-paginated chrome that scrolls with the list —
  // macro strip, search bar, hero card, and inline empty states. The Masthead
  // is rendered as a pinned sibling above the FlatList (see return below) so the
  // logo + location pill stay fixed while the rest scrolls and pull-to-refresh.
  //
  // Built as an ELEMENT (not a function/component) so that re-rendering on each
  // keystroke reconciles in place rather than remounting — otherwise the search
  // TextInput would lose focus and dismiss the keyboard every character.
  const header = (
    <>
      <MacroStrip macros={inputs} onEdit={() => setFilterVisible(true)} />
      <SearchBar value={query} onChangeText={setQuery} onClear={handleClearQuery} />

      {!canSearch && (
        <View style={s.inlineEmpty}>
          <Ionicons name="search-outline" size={32} color={EDITORIAL.greenAccent} />
          <Text style={s.inlineEmptyText}>Find your next meal</Text>
          <Text style={s.inlineEmptyHint}>Search a restaurant or dish above, or tap Edit to set macro targets</Text>
        </View>
      )}

      {canSearch && outOfArea && (
        <View style={s.inlineEmpty}>
          <Ionicons name="leaf-outline" size={32} color={EDITORIAL.greenAccent} />
          <Text style={s.inlineEmptyText}>We're not in your area yet</Text>
          <Text style={s.inlineEmptyHint}>
            Fitsy is launching in Los Angeles first - your city is next on the list.
          </Text>
          <Pressable
            style={({ pressed }) => [s.waitlistBtn, pressed && s.waitlistBtnPressed]}
            onPress={handleJoinWaitlist}
            accessibilityRole="button"
            accessibilityLabel="Keep me posted"
          >
            <Text style={s.waitlistBtnText}>Keep me posted</Text>
          </Pressable>
        </View>
      )}

      {canSearch && !outOfArea && results.length === 0 && (
        <View style={s.inlineEmpty}>
          <Ionicons name="search-outline" size={32} color={EDITORIAL.creamDeep} />
          <Text style={s.inlineEmptyText}>No matches nearby</Text>
          <Text style={s.inlineEmptyHint}>
            {hasQuery ? `Nothing matched "${query.trim()}" - try different terms or a wider area` : 'Try adjusting your macro targets'}
          </Text>
        </View>
      )}

      {canSearch && heroResult && <HeroCard result={heroResult} locked={locked === true} />}

      {canSearch && locked && (results.length > 0) && (
        <View style={s.lockedBanner}>
          <Ionicons name="lock-closed" size={14} color={EDITORIAL.greenAccent} />
          <Text style={s.lockedBannerText}>
            Subscribe to see exactly which meals at each spot fit your macros.
          </Text>
        </View>
      )}
    </>
  );

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

  // Only the very first load (before any query interaction, nothing to show
  // yet) gets the full-screen brand loader. Query-driven refetches keep the
  // list — and the SearchBar in its header — mounted, so a debounced fetch
  // mid-typing can't unmount the TextInput and dismiss the keyboard. Stale
  // results stay visible under the new results until they arrive. See
  // shouldShowInitialLoader for the invariant + its regression test.
  const initialLoading = shouldShowInitialLoader({
    loading,
    resultCount: results.length,
    hasQuery,
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: EDITORIAL.cream }}>
      <Masthead locationLabel={locationLabel} onLocationPress={handleOpenLocationPicker} />
      {initialLoading && (
        <View style={s.loaderWrap}>
          <FitsyLoader size="md" />
        </View>
      )}
      {!loading && error !== null && (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}
      {!initialLoading && (
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
          data={canSearch ? listResults : []}
          keyExtractor={(r) => r.id}
          renderItem={({ item, index }) => (
            // Hero (#01) + the first two sections (#02, #03) stay open - real
            // name/photo/distance, dish teased but not shown. #04 onward is
            // fully blurred and routes straight to the paywall on tap.
            locked && index >= 2
              ? <LockedRestaurantSection result={item} index={index} />
              : <RestaurantSection result={item} index={index} locked={locked === true} />
          )}
          ListHeaderComponent={header}
          ListFooterComponent={renderFooter}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={EDITORIAL.greenAccent}
              colors={[EDITORIAL.greenAccent]}
            />
          }
        />
      )}
      {isOnboardingPreview && locked !== false && (
        // The tab bar is hidden during the teaser, so this is the one
        // always-visible way out: sign-up for a new visitor, the paywall
        // for a signed-in but unsubscribed one (routeToPaywall decides).
        // Keyed on the preview entry, not on a successful locked fetch - a
        // network error on the very first search must not leave the user
        // with no tab bar *and* no way forward. Only hidden once a fetch
        // proves the caller is actually entitled.
        <View style={s.unlockBar}>
          <Pressable
            style={({ pressed }) => [s.unlockBtn, pressed && s.unlockBtnPressed]}
            onPress={() => { void routeToPaywall(); }}
            accessibilityRole="button"
            accessibilityLabel="Unlock everything"
          >
            <Ionicons name="lock-open-outline" size={16} color={EDITORIAL.cream} />
            <Text style={s.unlockBtnText}>Unlock everything</Text>
          </Pressable>
        </View>
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

  // Macro target strip: a row of `value / label` columns separated by hairlines,
  // capped on the right by an Edit pill. Layout principles:
  //  - The whole row is `alignItems: 'stretch'` so dividers can fill the
  //    available height without hard-coded numbers — the strip's intrinsic
  //    height comes from the tallest child (the Edit pill).
  //  - Each column is its own flex unit; `justifyContent: 'center'` keeps the
  //    value+label pair vertically centered against the pill.
  //  - Edit pill height is set via paddingVertical so it dictates strip height.
  // Macro target strip — value + label per macro, hairline dividers, Edit
  // pill on the right. Mirrors the original v3 layout: substantial values,
  // readable labels, tall dividers that frame each column, Edit button
  // sized as a proper pill rather than a chip.
  // Macro strip: row aligned center so each child takes its natural height
  // (column = val+lbl ≈ 28pt; Edit pill matches via explicit padding). Strip
  // padding adds a uniform 6pt breathing room on all sides.
  macroStrip: {
    flexDirection: 'row', alignItems: 'center',
    // Lighter than the search bar (creamCard) so the two stacked rows don't
    // read as one redundant block — the strip's border + dividers keep it
    // delineated against the page.
    backgroundColor: EDITORIAL.cream,
    borderRadius: 10, borderWidth: 1, borderColor: EDITORIAL.border,
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  macroItem: { flex: 1, alignItems: 'center', gap: 0 },
  macroVal: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 12,
    color: EDITORIAL.text,
  },
  macroLbl: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 9,
    color: EDITORIAL.textSoft,
    letterSpacing: 0.3,
  },
  macroDivider: { width: 1, height: 20, backgroundColor: EDITORIAL.creamDeep },
  editBtn: {
    backgroundColor: EDITORIAL.green, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, marginLeft: 8,
  },
  editBtnText: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 11,
    color: EDITORIAL.cream,
    letterSpacing: 0.2,
  },

  // Collapsed icon pill — compact, left-aligned (auto width, not a full row).
  // Search row — matches the restaurant detail screen's menu search input
  // (app/restaurant/[id].tsx): ⌕ glyph + × clear, creamCard pill, radius 14.
  search: {
    marginHorizontal: 18, marginBottom: 8,
    backgroundColor: EDITORIAL.creamCard,
    borderWidth: 1, borderColor: EDITORIAL.border, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  searchIco: { fontFamily: FONTS.nunitoSans, fontSize: 16, color: EDITORIAL.textSoft },
  searchInput: { fontFamily: FONTS.nunitoSans, flex: 1, fontSize: 13.5, color: EDITORIAL.text, padding: 0 },
  searchClear: { fontFamily: FONTS.nunitoSans, fontSize: 18, color: EDITORIAL.textSoft, paddingHorizontal: 4 },

  restSection: { marginTop: 22 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, marginBottom: 10,
  },
  sectionIndex: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 32, color: EDITORIAL.creamDeep,
    lineHeight: 34, letterSpacing: -1,
  },
  sectionTitleBlock: { flex: 1 },
  sectionRestName: {
    fontFamily: FONTS.frauncesDisplayBold,
    fontSize: 20, color: EDITORIAL.text, letterSpacing: -0.5, lineHeight: 24,
  },
  sectionSub: { fontFamily: FONTS.nunitoSans, fontSize: 11, fontWeight: '500', color: EDITORIAL.textSoft, marginTop: 2 },
  viewMenu: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 12, fontWeight: '600', color: EDITORIAL.greenAccent, paddingHorizontal: 20, marginTop: 6 },

  // Name+distance for a fully-locked row (#04+) - sized to just the text so
  // the blur below it hugs the text block rather than spanning the row.
  lockedNameWrap: { flex: 1, borderRadius: 6, overflow: 'hidden' },

  lockedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 18, marginBottom: 4,
    backgroundColor: EDITORIAL.creamDeep, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  lockedBannerText: { flex: 1, fontFamily: FONTS.nunitoSans, fontSize: 12.5, color: EDITORIAL.text, lineHeight: 17 },

  inlineEmpty: { alignItems: 'center', paddingTop: 50, paddingBottom: 30, gap: 8 },
  inlineEmptyText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 15, fontWeight: '600', color: EDITORIAL.textSoft },
  inlineEmptyHint: { fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.textSoft, textAlign: 'center', lineHeight: 20 },
  waitlistBtn: {
    marginTop: 12,
    backgroundColor: EDITORIAL.green,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 28,
  },
  waitlistBtnPressed: { opacity: 0.85 },
  waitlistBtnText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 15, fontWeight: '700', color: EDITORIAL.cream },
  footerSpinner: { paddingVertical: 24, alignItems: 'center', justifyContent: 'center' },
  unlockBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12,
    backgroundColor: EDITORIAL.cream, borderTopWidth: 1, borderTopColor: EDITORIAL.border,
  },
  unlockBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 16,
  },
  unlockBtnPressed: { opacity: 0.85 },
  unlockBtnText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
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

  lockedWrap: { marginTop: 4, height: 34, justifyContent: 'center', gap: 5, overflow: 'hidden', borderRadius: 6 },
  lockedBarWide: { width: '55%', height: 14, borderRadius: 4, backgroundColor: 'rgba(253,251,247,0.55)' },
  lockedBarNarrow: { width: '35%', height: 10, borderRadius: 3, backgroundColor: 'rgba(253,251,247,0.4)' },
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

  lockedWrap: { height: 34, justifyContent: 'center', gap: 5, overflow: 'hidden', borderRadius: 6 },
  lockedBarWide: { width: '65%', height: 14, borderRadius: 4, backgroundColor: 'rgba(253,251,247,0.55)' },
  lockedBarNarrow: { width: '45%', height: 10, borderRadius: 3, backgroundColor: 'rgba(253,251,247,0.4)' },

  // Fully-locked row (#04+): centered lock badge over the blurred real photo.
  lockedFullBadgeWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  lockedFullBadge: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(15,31,21,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
});
