import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RestaurantResult } from '@fitsy/shared';
import { LocationBar } from '@/components/LocationBar';
import { MacroInputBar, RestaurantCard } from '@/components';
import type { MacroValues } from '@/lib/macroPresets';
import { fetchRestaurants } from '@/lib/apiClient';
import { useLocation } from '@/lib/useLocation';

const DEBOUNCE_MS = 600;
const STORAGE_KEY = 'fitsy:macroTargets';

const DEFAULT_INPUTS: MacroValues = {
  protein: '',
  carbs: '',
  fat: '',
  calories: '',
};

function EmptyState({ hasInputs }: { hasInputs: boolean }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>
        {hasInputs
          ? 'No restaurants match your macro targets'
          : 'Enter macro targets above to find matching restaurants'}
      </Text>
    </View>
  );
}

export default function SearchScreen() {
  const [inputs, setInputs] = useState<MacroValues>(DEFAULT_INPUTS);
  const [results, setResults] = useState<RestaurantResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);

  const location = useLocation();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasInputs =
    inputs.protein !== '' ||
    inputs.carbs !== '' ||
    inputs.fat !== '' ||
    inputs.calories !== '';

  // Load persisted macro targets on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          setInputs(JSON.parse(raw) as MacroValues);
        }
      })
      .catch(() => {
        // Ignore storage errors — use defaults
      })
      .finally(() => {
        setHasHydrated(true);
      });
  }, []);

  // Persist macro targets whenever they change (only after hydration)
  useEffect(() => {
    if (!hasHydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(inputs)).catch(() => {
      // Ignore storage write errors
    });
  }, [inputs, hasHydrated]);

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
        setResults(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load results');
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Re-run search when inputs or resolved location changes.
  // Wait until location is resolved (loading: false) to avoid a redundant
  // fetch with fallback coords immediately followed by one with real coords.
  useEffect(() => {
    if (location.loading) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
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

  const handleChange = useCallback(
    (field: keyof MacroValues, value: string) => {
      setInputs((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleChangeAll = useCallback((values: MacroValues) => {
    setInputs(values);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Macro target inputs + presets */}
        <MacroInputBar
          values={inputs}
          onChange={handleChange}
          onChangeAll={handleChangeAll}
        />

        {/* Location status bar */}
        <LocationBar location={location} />

        {/* Loading */}
        {loading && (
          <ActivityIndicator
            size="small"
            color="#2D7D46"
            style={styles.spinner}
            accessibilityLabel="Loading restaurants"
          />
        )}

        {/* Error */}
        {!loading && error !== null && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Results list */}
        {!loading && error === null && (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <RestaurantCard
                item={item}
                onPress={() => router.push(`/restaurant/${item.id}`)}
              />
            )}
            ListEmptyComponent={<EmptyState hasInputs={hasInputs} />}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  flex: {
    flex: 1,
  },
  spinner: {
    marginTop: 32,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
    textAlign: 'center',
  },
  listContent: {
    flexGrow: 1,
    paddingTop: 8,
    paddingBottom: 24,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 64,
  },
  emptyStateText: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
});
