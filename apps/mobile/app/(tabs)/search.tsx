import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { EmptyState } from '@/components';
import { FitsyLoader } from '@/components/FitsyLoader';
import { FilterPopup } from '@/components/FilterPopup';
import type { MacroValues } from '@/lib/macroPresets';
import { fetchRestaurants } from '@/lib/apiClient';
import { useLocation } from '@/lib/useLocation';
import { getMacroTargets, saveMacroTargets } from '@/lib/macroStorage';
import { EDITORIAL, FONTS } from '@/lib/brand';
import {
  trackRestaurantTapped,
  trackSearchPerformed,
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

function Masthead({ locationLabel }: { locationLabel: string }) {
  return (
    <View style={s.masthead}>
      <View style={s.mastheadTop}>
        <View style={s.logoRow}>
          <View style={s.logoDot} />
          <Text style={s.logo}>fitsy</Text>
        </View>
        <View style={s.locationChip}>
          <Ionicons name="location" size={11} color={EDITORIAL.greenAccent} />
          <Text style={s.locationText}>{locationLabel}</Text>
        </View>
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
        <Text style={s.macroLbl}>kcal</Text>
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
          params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl },
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
            params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl },
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
      params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl },
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialFetch = useRef(true);
  const [filterVisible, setFilterVisible] = useState(false);
  const [cuisineFilter, setCuisineFilter] = useState('all');

  const location = useLocation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasInputs =
    inputs.protein !== '' || inputs.carbs !== '' || inputs.fat !== '' || inputs.calories !== '';

  // Load saved macro targets before initial fetch
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  useEffect(() => {
    getMacroTargets()
      .then((saved) => { if (saved) setInputs(saved); })
      .catch(() => {})
      .finally(() => setTargetsLoaded(true));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!targetsLoaded) return;
      getMacroTargets()
        .then((saved) => { if (saved) setInputs(saved); })
        .catch(() => {});
    }, [targetsLoaded]),
  );

  const doFetch = useCallback(
    async (current: MacroValues, lat: number, lng: number, cuisine: string, locationSource: 'gps' | 'fallback') => {
      setLoading(true);
      setError(null);

      const params: Parameters<typeof fetchRestaurants>[0] = { lat, lng };
      const protein = parseFloat(current.protein);
      const carbs = parseFloat(current.carbs);
      const fat = parseFloat(current.fat);
      const calories = parseFloat(current.calories);

      if (!isNaN(protein)) params.protein = protein;
      if (!isNaN(carbs)) params.carbs = carbs;
      if (!isNaN(fat)) params.fat = fat;
      if (!isNaN(calories)) params.calories = calories;
      if (cuisine !== 'all') params.cuisineType = cuisine;

      try {
        const data = await fetchRestaurants(params);
        setResults(data);
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
      } catch {
        setResults([]);
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
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!targetsLoaded || location.loading) return;
    if (!hasInputs) { setLoading(false); return; }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const locSource: 'gps' | 'fallback' = location.source === 'gps' ? 'gps' : 'fallback';

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

  function handleApplyFilters(newValues: MacroValues) {
    setFilterVisible(false);
    setInputs(newValues);
    saveMacroTargets(newValues).catch(() => {});
  }

  const locationLabel = location.loading
    ? 'Locating...'
    : location.source === 'gps'
      ? 'Near You'
      : 'Silver Lake, LA';

  const [heroResult, ...listResults] = results;

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
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
        >
          <Masthead locationLabel={locationLabel} />
          <MacroStrip macros={inputs} onEdit={() => setFilterVisible(true)} />
          <CuisineRow selected={cuisineFilter} onSelect={setCuisineFilter} />

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

          {hasInputs && listResults.map((r, i) => (
            <RestaurantSection key={r.id} result={r} index={i} />
          ))}
        </ScrollView>
      )}
      <FilterPopup
        visible={filterVisible}
        values={inputs}
        onApply={handleApplyFilters}
        onClose={() => setFilterVisible(false)}
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
    fontSize: 20,
    fontFamily: FONTS.newsreaderBold,
    color: EDITORIAL.green,
    letterSpacing: -0.5,
  },
  locationChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: EDITORIAL.creamCard, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: EDITORIAL.border,
  },
  locationText: { fontSize: 11, fontWeight: '600', color: EDITORIAL.textSoft },
  issueLabel: {
    fontSize: 10, fontWeight: '700', color: EDITORIAL.textSoft,
    letterSpacing: 2.5, textTransform: 'uppercase',
  },

  macroStrip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 10, borderWidth: 1, borderColor: EDITORIAL.border,
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  macroItem: { flex: 1, alignItems: 'center', gap: 1 },
  macroVal: { fontSize: 12, fontWeight: '700', color: EDITORIAL.text },
  macroLbl: { fontSize: 8, fontWeight: '600', color: EDITORIAL.textSoft, letterSpacing: 0.3 },
  macroDivider: { width: 1, height: 22, backgroundColor: EDITORIAL.creamDeep },
  editBtn: {
    backgroundColor: EDITORIAL.green, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7, marginLeft: 8,
  },
  editBtnText: { fontSize: 11, fontWeight: '700', color: EDITORIAL.cream, letterSpacing: 0.2 },

  filterRow: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 7 },
  filterBubble: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 18, borderWidth: 1, borderColor: EDITORIAL.border,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  filterBubbleActive: { backgroundColor: EDITORIAL.green, borderColor: EDITORIAL.green },
  filterLabel: { fontSize: 12, fontWeight: '600', color: EDITORIAL.textSoft },
  filterLabelActive: { color: EDITORIAL.cream },

  restSection: { marginTop: 22 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 20, marginBottom: 10,
  },
  sectionIndex: {
    fontFamily: FONTS.newsreaderItalic,
    fontSize: 32, color: EDITORIAL.creamDeep,
    lineHeight: 34, letterSpacing: -1,
  },
  sectionTitleBlock: { flex: 1, paddingTop: 4 },
  sectionRestName: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 20, color: EDITORIAL.text, letterSpacing: -0.5,
  },
  sectionSub: { fontSize: 11, fontWeight: '500', color: EDITORIAL.textSoft, marginTop: 1 },
  viewMenu: { fontSize: 12, fontWeight: '600', color: EDITORIAL.greenAccent, paddingHorizontal: 20, marginTop: 6 },

  inlineEmpty: { alignItems: 'center', paddingTop: 50, paddingBottom: 30, gap: 8 },
  inlineEmptyText: { fontSize: 15, fontWeight: '600', color: EDITORIAL.textSoft },
  inlineEmptyHint: { fontSize: 13, color: EDITORIAL.creamDeep },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBanner: {
    marginHorizontal: 16, marginTop: 16, borderRadius: 8, padding: 12,
    backgroundColor: '#FEF2F2',
  },
  errorText: { fontSize: 14, textAlign: 'center', color: '#DC2626' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 16, fontWeight: '500', color: EDITORIAL.textSoft },
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
  indexText: { fontSize: 11, fontWeight: '800', color: 'rgba(253,251,247,0.95)', letterSpacing: 0.5 },
  badgeRow: { flexDirection: 'row', gap: 4 },
  badge: {
    backgroundColor: 'rgba(253,251,247,0.18)', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '700', color: 'rgba(253,251,247,0.9)', letterSpacing: 1 },
  distText: { fontSize: 11, fontWeight: '600', color: 'rgba(253,251,247,0.65)', marginLeft: 'auto' },
  restName: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 28, color: EDITORIAL.cream, letterSpacing: -0.8, lineHeight: 30,
  },
  dishName: {
    fontFamily: FONTS.newsreaderItalic,
    fontSize: 18, color: 'rgba(253,251,247,0.85)', letterSpacing: -0.3,
  },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  macroText: { fontSize: 11, fontWeight: '600', color: 'rgba(253,251,247,0.6)' },
  dot: { fontSize: 11, color: 'rgba(253,251,247,0.3)' },
  calText: { fontSize: 11, fontWeight: '700', color: 'rgba(253,251,247,0.88)' },
});

const dc = StyleSheet.create({
  container: {
    height: DISH_CARD_H, borderRadius: 16, overflow: 'hidden',
    backgroundColor: EDITORIAL.creamDeep,
    marginHorizontal: 16,
  },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: DISH_CARD_H * 0.8 },
  info: { position: 'absolute', bottom: 10, left: 10, right: 10 },
  dishName: {
    fontSize: 13, fontFamily: FONTS.newsreaderBold,
    color: EDITORIAL.cream, letterSpacing: -0.2, lineHeight: 16,
  },
  cal: { fontSize: 9, fontWeight: '600', color: 'rgba(253,251,247,0.65)', marginTop: 2 },
});
