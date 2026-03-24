import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { RestaurantResult } from '@fitsy/shared';
import { RestaurantCard } from '@/components';
import { fetchRestaurants } from '@/lib/apiClient';

interface MacroInputs {
  protein: string;
  carbs: string;
  fat: string;
  calories: string;
}

const DEBOUNCE_MS = 600;

function MacroField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.macroField}>
      <Text style={styles.macroLabel}>{label}</Text>
      <TextInput
        style={styles.macroInput}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder="—"
        placeholderTextColor="#9CA3AF"
        returnKeyType="done"
        accessibilityLabel={`${label} in grams`}
        maxLength={5}
      />
    </View>
  );
}

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
  const [inputs, setInputs] = useState<MacroInputs>({
    protein: '',
    carbs: '',
    fat: '',
    calories: '',
  });
  const [results, setResults] = useState<RestaurantResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasInputs =
    inputs.protein !== '' ||
    inputs.carbs !== '' ||
    inputs.fat !== '' ||
    inputs.calories !== '';

  const doFetch = useCallback(async (current: MacroInputs) => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof fetchRestaurants>[0] = {};
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
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      doFetch(inputs);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [inputs, doFetch]);

  const setField = useCallback(
    (field: keyof MacroInputs) => (value: string) => {
      setInputs((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Macro target inputs */}
        <View style={styles.inputBar}>
          <MacroField
            label="Protein (g)"
            value={inputs.protein}
            onChange={setField('protein')}
          />
          <MacroField
            label="Carbs (g)"
            value={inputs.carbs}
            onChange={setField('carbs')}
          />
          <MacroField
            label="Fat (g)"
            value={inputs.fat}
            onChange={setField('fat')}
          />
          <MacroField
            label="Cals"
            value={inputs.calories}
            onChange={setField('calories')}
          />
        </View>

        {/* Location label */}
        <View style={styles.locationBar}>
          <Text style={styles.locationText}>Searching near Silver Lake, LA</Text>
        </View>

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
            renderItem={({ item }) => <RestaurantCard item={item} />}
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
  inputBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  macroField: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  macroLabel: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  macroInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 6,
    fontSize: 14,
    color: '#111827',
    textAlign: 'center',
    backgroundColor: '#F9FAFB',
  },
  locationBar: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
  },
  locationText: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
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
