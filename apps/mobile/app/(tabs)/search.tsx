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
import { RestaurantResult } from '@fitsy/shared';
import { EmptyState, RestaurantCard } from '@/components';
import { SearchHeader } from '@/components/SearchHeader';
import { FilterPopup } from '@/components/FilterPopup';
import type { MacroValues } from '@/lib/macroPresets';
import { fetchRestaurants } from '@/lib/apiClient';
import { useLocation } from '@/lib/useLocation';
import { getMacroTargets, saveMacroTargets } from '@/lib/macroStorage';
import { useTheme } from '@/lib/theme';

const DEBOUNCE_MS = 600;

const DEFAULT_INPUTS: MacroValues = {
  protein: '',
  carbs: '',
  fat: '',
  calories: '',
};

export default function SearchScreen() {
  const [inputs, setInputs] = useState<MacroValues>(DEFAULT_INPUTS);
  const [results, setResults] = useState<RestaurantResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const { colors } = useTheme();

  const location = useLocation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasInputs =
    inputs.protein !== '' ||
    inputs.carbs !== '' ||
    inputs.fat !== '' ||
    inputs.calories !== '';

  // Hydrate macro targets from storage on mount
  useEffect(() => {
    getMacroTargets()
      .then((saved) => {
        if (saved) setInputs(saved);
      })
      .catch(() => {});
  }, []);

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

  function openFilters() {
    setFilterVisible(true);
  }

  function handleApplyFilters(newValues: MacroValues) {
    setFilterVisible(false);
    setInputs(newValues);
    saveMacroTargets(newValues).catch(() => {});
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SearchHeader values={inputs} location={location} onPress={openFilters} />
        {loading && (
          <ActivityIndicator
            size="small"
            color={colors.accent}
            style={styles.spinner}
            accessibilityLabel="Loading restaurants"
          />
        )}
        {!loading && error !== null && (
          <View style={[styles.errorBanner, { backgroundColor: colors.errorBg }]}>
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        )}
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
      <FilterPopup
        visible={filterVisible}
        values={inputs}
        onApply={handleApplyFilters}
        onClose={() => setFilterVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  listContent: {
    flexGrow: 1,
    paddingTop: 8,
    paddingBottom: 100,
  },
});
