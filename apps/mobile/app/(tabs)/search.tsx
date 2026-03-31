import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RestaurantResult } from '@fitsy/shared';
import { EmptyState } from '@/components';
import { FitsyLoader } from '@/components/FitsyLoader';
import { ScreenBackground } from '@/components/ScreenBackground';
import { SearchHeader } from '@/components/SearchHeader';
import { FilterPopup } from '@/components/FilterPopup';
import type { MacroValues } from '@/lib/macroPresets';
import { fetchRestaurants } from '@/lib/apiClient';
import { useLocation } from '@/lib/useLocation';
import { getMacroTargets, saveMacroTargets } from '@/lib/macroStorage';
import { useTheme } from '@/lib/theme';

const DEBOUNCE_MS = 600;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

function matchScoreToFitPct(score: number): number {
  return Math.max(0, Math.round((1 - score) * 100));
}

// Mock data shown when DB is empty (pre-population)
const MOCK_RESULTS = [
  {
    id: 'mock-1', name: 'Evergreen Kitchen', address: '1424 Sunset Blvd, Silver Lake',
    lat: 34.0875, lng: -118.2604, distanceMiles: 1.2, cuisineTags: ['healthy', 'bowls'],
    photoUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=70',
    bestMatch: { name: 'Seared Ahi Bowl', calories: 482, proteinG: 42, carbsG: 38, fatG: 14, matchScore: 0.02, confidence: 'HIGH', menuItemId: 'mock-mi-1' },
  },
  {
    id: 'mock-2', name: 'The Iron Grill', address: '3302 Glendale Blvd, Los Angeles',
    lat: 34.0922, lng: -118.2587, distanceMiles: 2.8, cuisineTags: ['american', 'grill'],
    photoUrl: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&q=70',
    bestMatch: { name: 'High Protein Burger', calories: 520, proteinG: 38, carbsG: 12, fatG: 26, matchScore: 0.15, confidence: 'MEDIUM', menuItemId: 'mock-mi-2' },
  },
  {
    id: 'mock-3', name: 'Mesa Verde', address: '2100 Echo Park Ave',
    lat: 34.0781, lng: -118.2606, distanceMiles: 3.1, cuisineTags: ['mexican', 'fresh'],
    photoUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=70',
    bestMatch: { name: 'Grilled Chicken Bowl', calories: 610, proteinG: 45, carbsG: 52, fatG: 18, matchScore: 0.22, confidence: 'HIGH', menuItemId: 'mock-mi-3' },
  },
  {
    id: 'mock-4', name: 'Harvest Market', address: '890 Hyperion Ave',
    lat: 34.0955, lng: -118.2732, distanceMiles: 1.5, cuisineTags: ['organic', 'salads'],
    photoUrl: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&q=70',
    bestMatch: { name: 'Power Greens Salad', calories: 445, proteinG: 32, carbsG: 28, fatG: 20, matchScore: 0.08, confidence: 'HIGH', menuItemId: 'mock-mi-4' },
  },
] as RestaurantResult[];

const DEFAULT_INPUTS: MacroValues = {
  protein: '',
  carbs: '',
  fat: '',
  calories: '',
};

/* ─── Dish carousel card (glassmorphic) ─────────────────────────── */
function DishCard({ item, colors }: { item: RestaurantResult['bestMatch'] & { restaurantName?: string }; colors: any }) {
  if (!item) return null;
  return (
    <View style={[ds.card, { backgroundColor: 'rgba(21,26,33,0.75)', borderColor: 'rgba(68,72,79,0.2)' }]}>
      <View style={ds.cardTop}>
        <Image
          source={{ uri: item.restaurantName ? getMockImage(item.restaurantName) : getMockImage(item.name) }}
          style={ds.cardThumb}
        />
        <View style={ds.cardInfo}>
          <Text style={[ds.cardRestName, { color: colors.textPrimary }]} numberOfLines={1}>
            {item.restaurantName || 'Restaurant'}
          </Text>
          <Text style={[ds.cardMatchPill, { color: '#4ADE80' }]}>
            ● MATCH: {matchScoreToFitPct(item.matchScore)}%
          </Text>
        </View>
      </View>
      <Text style={[ds.cardDishName, { color: colors.textPrimary }]} numberOfLines={1}>
        {item.name}
      </Text>
      <View style={ds.cardMacros}>
        <Text style={ds.cardMacroLabel}>P</Text>
        <Text style={[ds.cardMacroVal, { color: colors.textPrimary }]}>{item.proteinG}g</Text>
        <Text style={ds.cardMacroLabel}>  C</Text>
        <Text style={[ds.cardMacroVal, { color: colors.textPrimary }]}>{item.carbsG}g</Text>
        <Text style={ds.cardMacroLabel}>  F</Text>
        <Text style={[ds.cardMacroVal, { color: colors.textPrimary }]}>{item.fatG}g</Text>
        <Text style={[ds.cardCalories, { color: '#4ADE80' }]}>  {item.calories} kcal</Text>
      </View>
    </View>
  );
}

export default function SearchScreen() {
  const [inputs, setInputs] = useState<MacroValues>(DEFAULT_INPUTS);
  const [results, setResults] = useState<RestaurantResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialFetch = useRef(true);
  const [filterVisible, setFilterVisible] = useState(false);
  const { colors } = useTheme();

  const location = useLocation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasInputs =
    inputs.protein !== '' ||
    inputs.carbs !== '' ||
    inputs.fat !== '' ||
    inputs.calories !== '';

  useFocusEffect(
    useCallback(() => {
      getMacroTargets()
        .then((saved) => {
          if (saved) setInputs(saved);
        })
        .catch(() => {});
    }, []),
  );

  const doFetch = useCallback(
    async (current: MacroValues, lat: number, lng: number) => {
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

      try {
        const data = await fetchRestaurants(params);
        setResults(data.length > 0 ? data : MOCK_RESULTS);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load results');
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (location.loading) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (initialFetch.current) {
      initialFetch.current = false;
      doFetch(inputs, location.lat, location.lng);
      return;
    }

    debounceRef.current = setTimeout(() => {
      doFetch(inputs, location.lat, location.lng);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [inputs, location.lat, location.lng, location.loading, doFetch]);

  function openFilters() {
    setFilterVisible(true);
  }

  function handleApplyFilters(newValues: MacroValues) {
    setFilterVisible(false);
    setInputs(newValues);
    saveMacroTargets(newValues).catch(() => {});
  }

  const heroResult = results[0];
  const otherResults = results.slice(1);

  return (
    <ScreenBackground>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header rendered inside ScrollView below */}
        {loading && (
          <View style={styles.loaderWrap}>
            <FitsyLoader size="md" />
          </View>
        )}
        {!loading && error !== null && (
          <View style={[styles.errorBanner, { backgroundColor: colors.errorBg }]}>
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        )}
        {!loading && error === null && results.length === 0 && (
          <EmptyState hasInputs={hasInputs} />
        )}
        {!loading && error === null && results.length > 0 && (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={{ paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          >
            <SearchHeader values={inputs} location={location} onPress={openFilters} />
            {results.map((r) => (
              <TouchableOpacity
                key={r.id}
                activeOpacity={0.9}
                onPress={() => router.push({
                  pathname: `/restaurant/${r.id}`,
                  params: { address: r.address, distance: r.distanceMiles?.toFixed(1) },
                })}
                style={[styles.heroContainer, { borderColor: colors.border }]}
              >
                <Image
                  source={{ uri: r.photoUrl || getMockImage(r.name) }}
                  style={styles.heroImage}
                  resizeMode="cover"
                />
                <LinearGradient
                  colors={['transparent', 'rgba(10,14,20,0.92)']}
                  style={styles.heroGradient}
                />
                <View style={styles.heroOverlay}>
                  {r.bestMatch && (
                    <Text style={styles.heroTitle}>{r.bestMatch.name}</Text>
                  )}
                  <Text style={styles.heroMeta}>
                    {r.name} • {r.distanceMiles.toFixed(1)} mi
                  </Text>
                  {r.bestMatch && (
                    <View style={styles.heroMacroRow}>
                      <Text style={styles.heroMacroChip}>P {r.bestMatch.proteinG}g</Text>
                      <Text style={styles.heroMacroChip}>C {r.bestMatch.carbsG}g</Text>
                      <Text style={styles.heroMacroChip}>F {r.bestMatch.fatG}g</Text>
                      <Text style={styles.heroMacroCal}>{r.bestMatch.calories} kcal</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
      <FilterPopup
        visible={filterVisible}
        values={inputs}
        onApply={handleApplyFilters}
        onClose={() => setFilterVisible(false)}
      />
    </ScreenBackground>
  );
}

/* ─── Dish card styles ────────────────────────────────────────── */
const ds = StyleSheet.create({
  card: {
    width: 200,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginRight: 12,
    gap: 6,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardThumb: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#4ADE80',
    backgroundColor: '#151A21',
  },
  cardInfo: {
    flex: 1,
  },
  cardRestName: {
    fontSize: 13,
    fontWeight: '700',
  },
  cardMatchPill: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
  },
  cardDishName: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  cardMacros: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  cardMacroLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(168,171,179,0.6)',
  },
  cardMacroVal: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 2,
  },
  cardCalories: {
    fontSize: 13,
    fontWeight: '700',
  },
});

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  /* Hero cards */
  heroContainer: {
    height: 220,
    marginHorizontal: 14,
    marginBottom: 16,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(68,72,79,0.2)',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  heroOverlay: {
    position: 'absolute',
    bottom: 18,
    left: 18,
    right: 18,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F1F3FC',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  heroAccent: {
    fontSize: 17,
    fontWeight: '800',
    color: '#4ADE80',
    letterSpacing: -0.2,
    marginTop: 0,
  },
  heroMeta: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(241,243,252,0.6)',
    marginTop: 3,
  },
  heroMacroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 6,
  },
  heroMacroChip: {
    fontSize: 9,
    fontWeight: '600',
    color: 'rgba(241,243,252,0.4)',
    letterSpacing: 0.5,
  },
  heroMacroCal: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(74,222,128,0.7)',
  },
});
