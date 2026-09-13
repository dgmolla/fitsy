import { useCallback, useEffect, useRef, useState } from 'react';
import type { RestaurantResult } from '@fitsy/shared';
import type { MacroValues } from './macroPresets';
import type { UseLocationResult, LocationState } from './useLocation';
import { fetchRestaurantsPage } from './apiClient';
import { fetchGuidedPreview } from './guidedPreview';
import { saveOnboardingField } from './onboardingStorage';
import { recordSearchAndMaybePrompt } from './ratingPrompt';
import { trackSearchPerformed, trackSearchFailed, trackPreviewFetchFailed, trackSearchPageLoaded, trackSearchPaginationEndReached, trackSearchEmptyResults } from './analytics';
const DEBOUNCE_MS = 600;
interface DiscoveryInputs {
  inputs: MacroValues; query: string; location: UseLocationResult;
  canSearch: boolean; targetsLoaded: boolean; previewReady: boolean; isOnboardingPreview: boolean;
}
export function useDiscoveryResults({ inputs, query, location, canSearch, targetsLoaded, previewReady, isOnboardingPreview }: DiscoveryInputs) {
  const [results, setResults] = useState<RestaurantResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<boolean | null>(null);
  const [fetchSeq, setFetchSeq] = useState(0);
  const [outOfArea, setOutOfArea] = useState(false);
  const [nearbyDishCount, setNearbyDishCount] = useState<number>();
  const fetchGeneration = useRef(0);
  const pagesLoadedRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const endReachedFiredRef = useRef(false);
  const skipLocationFetchRef = useRef(false);
  const initialFetch = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      const generation = ++fetchGeneration.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      setOutOfArea(false);
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
        const previewResponse = isOnboardingPreview ? await fetchGuidedPreview({ lat, lng }, q, current) : null;
        const { data, nextCursor: cursor, locked: isLocked, networkError } = previewResponse
          ? { data: previewResponse.data, nextCursor: null, locked: true, networkError: false }
          : await fetchRestaurantsPage(params);
        if (generation !== fetchGeneration.current) return;
        if (previewResponse) {
          setNearbyDishCount(previewResponse.meta.nearbyDishCount);
          void saveOnboardingField('previewArea', `${lat}:${lng}`).then(() => saveOnboardingField('previewCraving', q.trim())).catch(() => undefined);
        }
        if (networkError) {
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
        if (isOnboardingPreview && previewResponse?.meta.nearbyDishCount === 0) {
          setOutOfArea(true);
          setResults([]);
          setNextCursor(null);
          return;
        }
        setResults(data);
        setNextCursor(cursor);
        setLocked(isLocked);
        setFetchSeq((n) => n + 1);
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
          trackSearchEmptyResults({
            cuisine_filter: 'all',
            has_protein_target: !isNaN(protein),
            has_carbs_target: !isNaN(carbs),
            has_fat_target: !isNaN(fat),
            has_calories_target: !isNaN(calories),
          });
        } else if (!isLocked) {
          void recordSearchAndMaybePrompt();
        }
      } catch (err) {
        if (generation !== fetchGeneration.current) return;
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
        trackSearchFailed({
          cuisine_filter: 'all',
          error_message: err instanceof Error ? err.message : undefined,
        });
        if (isOnboardingPreview) trackPreviewFetchFailed(err);
      } finally {
        if (generation !== fetchGeneration.current) return;
        if (isRefresh) setRefreshing(false);
        else setLoading(false);
      }
    },
    [buildParams, isOnboardingPreview],
  );
  const handleRefresh = useCallback(async () => {
    if (!canSearch) return;
    setRefreshing(true);
    let lat = location.lat;
    let lng = location.lng;
    let source = location.source;
    try {
      const fresh = await location.refreshLocation();
      if (fresh) {
        if (fresh.lat !== location.lat || fresh.lng !== location.lng) {
          skipLocationFetchRef.current = true;
        }
        lat = fresh.lat;
        lng = fresh.lng;
        source = fresh.source;
      }
    } catch {
      // Keep the selected coordinates if GPS refresh fails.
    }
    await doFetch(inputs, lat, lng, query, source, true);
  }, [
    doFetch,
    canSearch,
    inputs,
    location,
    query,
  ]);
  const handleEndReached = useCallback(async () => {
    if (!canSearch) return;
    if (locked) return;
    if (nextCursor === null) return;
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setLoadingMore(true);
    const generation = fetchGeneration.current;
    const cursorBeingFetched = nextCursor;
    const pageIndex = pagesLoadedRef.current;
    const params = buildParams(inputs, location.lat, location.lng, query);
    params.cursor = cursorBeingFetched;
    try {
      const { data, nextCursor: cursor, locked: isLocked } = await fetchRestaurantsPage(params);
      if (generation !== fetchGeneration.current) return;
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
      setLocked(isLocked);
      setFetchSeq((n) => n + 1);
      pagesLoadedRef.current = pageIndex + 1;
      trackSearchPageLoaded({
        page_index: pageIndex,
        result_count: data.length,
        cursor: cursorBeingFetched,
      });
      if (cursor === null && !endReachedFiredRef.current) {
        endReachedFiredRef.current = true;
        setResults((prev) => {
          trackSearchPaginationEndReached({
            total_results: prev.length,
            pages_loaded: pagesLoadedRef.current,
          });
          return prev;
        });
      }
    } catch {
      // Existing rows remain usable; the next scroll retries pagination.
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
    locked,
  ]);
  useEffect(() => {
    if (skipLocationFetchRef.current) {
      skipLocationFetchRef.current = false;
      return;
    }
    if (!targetsLoaded || location.loading || !previewReady) return;
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
  }, [inputs, location.lat, location.lng, location.loading, location.source, query, canSearch, doFetch, targetsLoaded, previewReady]);
  return { results, nextCursor, loading, loadingMore, refreshing, error, locked, fetchSeq, outOfArea, nearbyDishCount, doFetch, handleRefresh, handleEndReached };
}
