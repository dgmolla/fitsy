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
import { COLORS, FONTS } from '@/lib/brand';

const DEBOUNCE_MS = 600;
const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = SCREEN_W * 0.52;
const CARD_H = 180;

// ─── Cuisine filters ─────────────────────────────────────────────────────────

const CUISINE_FILTERS = [
  { id: 'all', label: 'All', icon: 'grid-outline' },
  { id: 'asian', label: 'Asian', icon: 'restaurant-outline' },
  { id: 'mexican', label: 'Mexican', icon: 'flame-outline' },
  { id: 'healthy', label: 'Healthy', icon: 'leaf-outline' },
  { id: 'fast_food', label: 'Fast Food', icon: 'fast-food-outline' },
  { id: 'vegan', label: 'Vegan', icon: 'nutrition-outline' },
  { id: 'italian', label: 'Italian', icon: 'pizza-outline' },
  { id: 'sushi', label: 'Sushi', icon: 'fish-outline' },
] as const;

// ─── Dietary / price filters ──────────────────────────────────────────────────

const DIETARY_FILTERS = [
  { id: 'all', label: 'All Diets' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'gluten-free', label: 'Gluten-Free' },
  { id: 'keto', label: 'Keto' },
  { id: 'dairy-free', label: 'Dairy-Free' },
] as const;

const PRICE_FILTERS = [
  { id: 'all', label: 'Any $' },
  { id: '$', label: '$' },
  { id: '$$', label: '$$' },
  { id: '$$$', label: '$$$' },
] as const;

// Map dietary tag stored in DB to a display label
const DIETARY_BADGE_LABELS: Record<string, string> = {
  has_vegan: 'Vegan',
  has_vegetarian: 'Veg',
  'has_gluten-free': 'GF',
  has_keto: 'Keto',
  'has_dairy-free': 'DF',
};

// ─── Mock images ─────────────────────────────────────────────────────────────

const MOCK_IMAGES = [
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=70',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=70',
  'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&q=70',
  'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&q=70',
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=70',
  'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&q=70',
];

function getMockImage(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MOCK_IMAGES[h % MOCK_IMAGES.length];
}

// Mock data shown when DB is empty
const MOCK_RESULTS = [
  { id: 'mock-1', name: 'Evergreen Kitchen', address: '1424 Sunset Blvd, Silver Lake', lat: 34.0875, lng: -118.2604, distanceMiles: 0.4, cuisineTags: ['healthy', 'bowls'], photoUrl: MOCK_IMAGES[0], bestMatch: { name: 'Seared Ahi Bowl', calories: 482, proteinG: 42, carbsG: 38, fatG: 14, matchScore: 0.02, confidence: 'HIGH' as const, menuItemId: 'mock-mi-1' } },
  { id: 'mock-2', name: 'The Iron Grill', address: '3302 Glendale Blvd', lat: 34.0922, lng: -118.2587, distanceMiles: 1.2, cuisineTags: ['american', 'fast_food'], photoUrl: MOCK_IMAGES[2], bestMatch: { name: 'Double Smash Burger', calories: 620, proteinG: 48, carbsG: 32, fatG: 28, matchScore: 0.12, confidence: 'MEDIUM' as const, menuItemId: 'mock-mi-2' } },
  { id: 'mock-3', name: 'Mesa Verde', address: '2100 Echo Park Ave', lat: 34.0781, lng: -118.2606, distanceMiles: 1.8, cuisineTags: ['mexican'], photoUrl: MOCK_IMAGES[4], bestMatch: { name: 'Chicken Burrito Bowl', calories: 610, proteinG: 45, carbsG: 52, fatG: 18, matchScore: 0.22, confidence: 'HIGH' as const, menuItemId: 'mock-mi-3' } },
  { id: 'mock-4', name: 'Harvest Market', address: '890 Hyperion Ave', lat: 34.0955, lng: -118.2732, distanceMiles: 0.9, cuisineTags: ['healthy', 'vegan'], photoUrl: MOCK_IMAGES[5], bestMatch: { name: 'Power Greens Salad', calories: 320, proteinG: 28, carbsG: 18, fatG: 16, matchScore: 0.08, confidence: 'HIGH' as const, menuItemId: 'mock-mi-4' } },
  { id: 'mock-5', name: 'Sakura Ramen', address: '4501 Melrose Ave', lat: 34.0835, lng: -118.3100, distanceMiles: 2.0, cuisineTags: ['asian', 'japanese'], photoUrl: MOCK_IMAGES[3], bestMatch: { name: 'Chicken Teriyaki Bowl', calories: 580, proteinG: 40, carbsG: 65, fatG: 14, matchScore: 0.30, confidence: 'HIGH' as const, menuItemId: 'mock-mi-5' } },
  { id: 'mock-6', name: 'Ocean Blue', address: '1200 Pacific Ave', lat: 34.0800, lng: -118.2900, distanceMiles: 1.5, cuisineTags: ['healthy', 'seafood'], photoUrl: MOCK_IMAGES[1], bestMatch: { name: 'Grilled Salmon Plate', calories: 510, proteinG: 44, carbsG: 28, fatG: 22, matchScore: 0.06, confidence: 'HIGH' as const, menuItemId: 'mock-mi-6' } },
] as RestaurantResult[];

const DEFAULT_INPUTS: MacroValues = { protein: '', carbs: '', fat: '', calories: '' };

// ─── Categorization ──────────────────────────────────────────────────────────

interface Category {
  title: string;
  data: RestaurantResult[];
}

function categorize(results: RestaurantResult[], isFiltered: boolean): Category[] {
  if (results.length === 0) return [];

  // When filters are active, results are already server-filtered — show flat list
  if (isFiltered) {
    return [{ title: 'Results', data: results }];
  }

  // Smart categories for unfiltered view
  const sorted = [...results].sort((a, b) => a.distanceMiles - b.distanceMiles);
  const nearYou = sorted.slice(0, Math.min(6, sorted.length));
  const highProtein = results.filter((r) => (r.bestMatch?.proteinG ?? 0) >= 30);
  const light = results.filter((r) => (r.bestMatch?.calories ?? 9999) <= 500);

  const categories: Category[] = [
    { title: 'Near You', data: nearYou },
    { title: 'High Protein', data: highProtein },
    { title: 'Quick & Light', data: light },
  ].filter((c) => c.data.length > 0);

  return categories.length > 0 ? categories : [{ title: 'Nearby', data: results }];
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MacroPill({ label, value, unit, highlight }: { label: string; value: string; unit?: string; highlight?: boolean }) {
  return (
    <View style={[s.macroPill, highlight && s.macroPillHighlight]}>
      {label ? <Text style={[s.macroPillLabel, highlight && s.macroPillLabelH]}>{label}</Text> : null}
      <Text style={[s.macroPillValue, highlight && s.macroPillValueH]}>{value}</Text>
      {unit ? <Text style={[s.macroPillUnit, highlight && s.macroPillUnitH]}>{unit}</Text> : null}
    </View>
  );
}

function Header({ macros, location: loc, onPress }: { macros: MacroValues; location: { loading: boolean; source: string }; onPress: () => void }) {
  const locationLabel = loc.loading ? 'Locating...' : loc.source === 'gps' ? 'Near you' : 'Silver Lake, LA';
  const p = macros.protein || '45';
  const c = macros.carbs || '60';
  const f = macros.fat || '12';
  const cal = macros.calories || '550';

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={s.header}>
      <View style={s.headerTop}>
        <View style={s.logoRow}>
          <Ionicons name="restaurant" size={18} color={COLORS.green} />
          <Text style={s.logo}>fitsy</Text>
        </View>
        <View style={s.locationPill}>
          <View style={s.locationDot} />
          <Text style={s.locationText}>{locationLabel}</Text>
        </View>
      </View>
      <Text style={s.greeting}>Food that fits.</Text>
      <View style={s.macroSummary}>
        <MacroPill label="P" value={`${p}g`} />
        <MacroPill label="C" value={`${c}g`} />
        <MacroPill label="F" value={`${f}g`} />
        <MacroPill label="" value={cal} unit="kcal" highlight />
      </View>
    </TouchableOpacity>
  );
}

function FilterChip({ label, active, onPress, icon }: { label: string; active: boolean; onPress: () => void; icon?: string }) {
  return (
    <TouchableOpacity
      style={[s.filterBubble, active && s.filterBubbleActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {icon ? <Ionicons name={icon as any} size={16} color={active ? '#FFFFFF' : COLORS.textSecondary} /> : null}
      <Text style={[s.filterLabel, active && s.filterLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function FiltersPanel({
  cuisine, onCuisine,
  dietary, onDietary,
  priceLevel, onPriceLevel,
}: {
  cuisine: string; onCuisine: (v: string) => void;
  dietary: string; onDietary: (v: string) => void;
  priceLevel: string; onPriceLevel: (v: string) => void;
}) {
  return (
    <View style={s.filtersPanel}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
        {CUISINE_FILTERS.map((f) => (
          <FilterChip key={f.id} label={f.label} icon={f.icon} active={f.id === cuisine} onPress={() => onCuisine(f.id)} />
        ))}
      </ScrollView>
      <View style={s.filterDivider} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
        {DIETARY_FILTERS.map((f) => (
          <FilterChip key={f.id} label={f.label} active={f.id === dietary} onPress={() => onDietary(f.id)} />
        ))}
        <View style={s.filterSeparator} />
        {PRICE_FILTERS.map((f) => (
          <FilterChip key={f.id} label={f.label} active={f.id === priceLevel} onPress={() => onPriceLevel(f.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

function DietaryBadges({ options }: { options?: string[] }) {
  if (!options || options.length === 0) return null;
  const badges = options
    .map((o) => DIETARY_BADGE_LABELS[o])
    .filter(Boolean) as string[];
  if (badges.length === 0) return null;
  return (
    <View style={card.badgeRow}>
      {badges.slice(0, 3).map((b) => (
        <View key={b} style={card.badge}>
          <Text style={card.badgeText}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

function MealCard({ result }: { result: RestaurantResult }) {
  const bm = result.bestMatch;
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={card.container}
      onPress={() => router.push({
        pathname: `/restaurant/${result.id}`,
        params: { address: result.address, distance: result.distanceMiles?.toFixed(1) },
      })}
    >
      <Image source={{ uri: result.photoUrl || getMockImage(result.name) }} style={card.image} resizeMode="cover" />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={card.gradient} />
      <View style={card.info}>
        {bm && <Text style={card.dishName} numberOfLines={1}>{bm.name}</Text>}
        <Text style={card.restName} numberOfLines={1}>
          {result.name} {'\u2022'} {result.distanceMiles.toFixed(1)} mi
          {result.priceLevel ? ` \u2022 ${result.priceLevel}` : ''}
          {result.rating ? ` \u2022 \u2605${result.rating.toFixed(1)}` : ''}
        </Text>
        <DietaryBadges options={result.dietaryOptions} />
        {bm && (
          <View style={card.macroRow}>
            <Text style={card.macroPill}>P {bm.proteinG}g</Text>
            <Text style={card.macroPill}>C {bm.carbsG}g</Text>
            <Text style={card.macroPill}>F {bm.fatG}g</Text>
            <Text style={card.calPill}>{bm.calories} kcal</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

function CategoryRow({ category }: { category: Category }) {
  return (
    <View style={s.categorySection}>
      <View style={s.categoryHeader}>
        <Text style={s.categoryTitle}>{category.title}</Text>
      </View>
      <FlatList
        data={category.data}
        keyExtractor={(r) => r.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.cardRow}
        renderItem={({ item }) => <MealCard result={item} />}
      />
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const [inputs, setInputs] = useState<MacroValues>(DEFAULT_INPUTS);
  const [results, setResults] = useState<RestaurantResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialFetch = useRef(true);
  const [filterVisible, setFilterVisible] = useState(false);
  const [cuisineFilter, setCuisineFilter] = useState('all');
  const [dietaryFilter, setDietaryFilter] = useState('all');
  const [priceLevelFilter, setPriceLevelFilter] = useState('all');

  const location = useLocation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasInputs =
    inputs.protein !== '' || inputs.carbs !== '' || inputs.fat !== '' || inputs.calories !== '';

  useFocusEffect(
    useCallback(() => {
      getMacroTargets()
        .then((saved) => { if (saved) setInputs(saved); })
        .catch(() => {});
    }, []),
  );

  const doFetch = useCallback(
    async (
      current: MacroValues,
      lat: number,
      lng: number,
      cuisine: string,
      dietary: string,
      priceLevel: string,
    ) => {
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
      if (dietary !== 'all') params.dietary = dietary;
      if (priceLevel !== 'all') params.maxPriceLevel = priceLevel;

      try {
        const data = await fetchRestaurants(params);
        setResults(data.length > 0 ? data : MOCK_RESULTS);
      } catch {
        setResults(MOCK_RESULTS);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (location.loading) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (initialFetch.current) {
      initialFetch.current = false;
      doFetch(inputs, location.lat, location.lng, cuisineFilter, dietaryFilter, priceLevelFilter);
      return;
    }

    debounceRef.current = setTimeout(() => {
      doFetch(inputs, location.lat, location.lng, cuisineFilter, dietaryFilter, priceLevelFilter);
    }, DEBOUNCE_MS);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputs, location.lat, location.lng, location.loading, cuisineFilter, dietaryFilter, priceLevelFilter, doFetch]);

  function handleApplyFilters(newValues: MacroValues) {
    setFilterVisible(false);
    setInputs(newValues);
    saveMacroTargets(newValues).catch(() => {});
  }

  const isFiltered = cuisineFilter !== 'all' || dietaryFilter !== 'all' || priceLevelFilter !== 'all';
  const categories = categorize(results, isFiltered);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
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
      {!loading && error === null && results.length === 0 && (
        <EmptyState hasInputs={hasInputs} />
      )}
      {!loading && results.length > 0 && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          <Header
            macros={inputs}
            location={location}
            onPress={() => setFilterVisible(true)}
          />
          <FiltersPanel
            cuisine={cuisineFilter}
            onCuisine={setCuisineFilter}
            dietary={dietaryFilter}
            onDietary={setDietaryFilter}
            priceLevel={priceLevelFilter}
            onPriceLevel={setPriceLevelFilter}
          />
          {categories.map((cat) => (
            <CategoryRow key={cat.title} category={cat} />
          ))}
          {categories.length === 0 && (
            <View style={s.emptyState}>
              <Ionicons name="search-outline" size={48} color={COLORS.textTertiary} />
              <Text style={s.emptyText}>No matches for this cuisine</Text>
            </View>
          )}
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

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: { backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logo: { fontSize: 22, fontWeight: '800', color: COLORS.green, letterSpacing: -0.8 },
  locationPill: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.borderLight,
    borderRadius: 14, paddingHorizontal: 11, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.border, gap: 5,
  },
  locationDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green },
  locationText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
  greeting: { fontFamily: FONTS.headline, fontSize: 26, color: COLORS.text, letterSpacing: -0.5, marginBottom: 12 },

  macroSummary: { flexDirection: 'row', gap: 8 },
  macroPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.borderLight, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  macroPillHighlight: { backgroundColor: COLORS.greenBg, borderColor: COLORS.green },
  macroPillLabel: { fontSize: 11, fontWeight: '800', color: COLORS.textTertiary },
  macroPillLabelH: { color: COLORS.greenDark },
  macroPillValue: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  macroPillValueH: { color: COLORS.green },
  macroPillUnit: { fontSize: 10, fontWeight: '600', color: COLORS.textTertiary, marginLeft: -2 },
  macroPillUnitH: { color: COLORS.greenDark },

  filtersPanel: { backgroundColor: '#FFFFFF' },
  filterDivider: { height: 1, marginHorizontal: 16, backgroundColor: COLORS.borderLight },
  filterSeparator: { width: 1, height: 20, backgroundColor: COLORS.border, alignSelf: 'center', marginHorizontal: 4 },
  filterRow: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  filterBubble: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  filterBubbleActive: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  filterLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  filterLabelActive: { color: '#FFFFFF' },

  categorySection: { marginTop: 8 },
  categoryHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, marginBottom: 12,
  },
  categoryTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, letterSpacing: -0.3 },
  cardRow: { paddingHorizontal: 16, gap: 12, paddingBottom: 16 },

  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBanner: { marginHorizontal: 16, marginTop: 16, borderRadius: 8, padding: 12, backgroundColor: COLORS.errorBg },
  errorText: { fontSize: 14, textAlign: 'center', color: COLORS.error },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 16, fontWeight: '500', color: COLORS.textTertiary },
});

const card = StyleSheet.create({
  container: {
    width: CARD_W, height: CARD_H, borderRadius: 18, overflow: 'hidden',
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
  },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: CARD_H * 0.7 },
  info: { position: 'absolute', bottom: 12, left: 12, right: 12 },
  dishName: { fontSize: 16, fontWeight: '700', color: '#F1F3FC', letterSpacing: -0.2 },
  restName: { fontSize: 11, fontWeight: '500', color: 'rgba(241,243,252,0.6)', marginTop: 2 },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  macroPill: { fontSize: 9, fontWeight: '600', color: 'rgba(241,243,252,0.5)', letterSpacing: 0.3 },
  calPill: { fontSize: 9, fontWeight: '700', color: 'rgba(74,222,128,0.8)' },
  badgeRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  badge: { backgroundColor: 'rgba(74,222,128,0.2)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  badgeText: { fontSize: 8, fontWeight: '700', color: 'rgba(74,222,128,0.9)', letterSpacing: 0.2 },
});
