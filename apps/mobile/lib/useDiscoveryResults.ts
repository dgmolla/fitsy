import { useCallback, useEffect, useRef, useState } from 'react';
import type { RestaurantResult } from '@fitsy/shared';
import type { MacroValues } from './macroPresets';
import type { UseLocationResult, LocationState } from './useLocation';
import { fetchRestaurantsPage } from './apiClient';
import { buildDiscoveryParams, discoveryTargetFlags } from './discoverySearchParams';
import { fetchGuidedPreview } from './guidedPreview';
import { saveOnboardingField } from './onboardingStorage';
import { recordFirstDiscoveryPage } from './discoverySearchTelemetry';
import { trackSearchPerformed, trackSearchFailed, trackPreviewFetchFailed, trackSearchPageLoaded, trackSearchPaginationEndReached } from './analytics';
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
  // Invalidate on the rendered context, before the debounce starts another request.
  // Otherwise an older response can repaint results for text the user already replaced.
  const contextKey = JSON.stringify([inputs.protein, inputs.carbs, inputs.fat, inputs.calories, location.lat, location.lng, query.trim(), isOnboardingPreview]);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const [completedContext, setCompletedContext] = useState<string>();
  const requestController = useRef<AbortController | null>(null);
  const pageController = useRef<AbortController | null>(null);
  const fetchGeneration = useRef(0);
  const pagesLoadedRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const endReachedFiredRef = useRef(false);
  const initialFetch = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      const requestContext = currentContext.current;
      requestController.current?.abort();
      pageController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      const isCurrent = () => generation === fetchGeneration.current && requestContext === currentContext.current && !controller.signal.aborted;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      setNearbyDishCount(undefined);
      setOutOfArea(false);
      pagesLoadedRef.current = 0;
      isLoadingMoreRef.current = false;
      setLoadingMore(false);
      endReachedFiredRef.current = false;
      setNextCursor(null);
      const params = buildDiscoveryParams(current, lat, lng, q);
      const targetFlags = discoveryTargetFlags(current);
      // A stalled native transport must not hold the search or tour indefinitely.
      const timeout = setTimeout(() => {
        if (!isCurrent()) return;
        controller.abort();
        setResults([]);
        setError('Search took too long. Check your connection and try again.');
        setCompletedContext(requestContext);
        setRefreshing(false);
        setLoading(false);
      }, 15_000);
      try {
        const previewResponse = isOnboardingPreview ? await fetchGuidedPreview({ lat, lng }, q, current, { signal: controller.signal, refresh: isRefresh }) : null;
        const { data, nextCursor: cursor, locked: isLocked, networkError } = previewResponse
          ? { data: previewResponse.data, nextCursor: null, locked: true, networkError: false }
          : await fetchRestaurantsPage(params, { signal: controller.signal });
        if (!isCurrent()) return;
        if (previewResponse) {
          setNearbyDishCount(previewResponse.meta.nearbyDishCount);
          void saveOnboardingField('previewArea', `${lat}:${lng}`).then(() => saveOnboardingField('previewCraving', q.trim())).catch(() => undefined);
        }
        if (networkError) {
          setResults([]);
          setNextCursor(null);
          setError('Network problem - check your connection and try again.');
          trackSearchPerformed({
            ...targetFlags,
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
        if (cursor === null) endReachedFiredRef.current = true;
        recordFirstDiscoveryPage(data.length, cursor, isLocked, targetFlags, q, locationSource);
      } catch (err) {
        if (!isCurrent()) return;
        setResults([]);
        setNextCursor(null);
        setError('Network problem - check your connection and try again.');
        trackSearchPerformed({
          ...targetFlags,
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
        clearTimeout(timeout);
        if (!isCurrent()) return;
        setCompletedContext(requestContext);
        setRefreshing(false);
        setLoading(false);
      }
    },
    [isOnboardingPreview],
  );
  const handleRefresh = useCallback(async () => {
    if (!canSearch) return;
    const refreshContext = currentContext.current;
    setRefreshing(true);
    let lat = location.lat;
    let lng = location.lng;
    let source = location.source;
    try {
      const fresh = await location.refreshLocation();
      if (fresh) {
        if (fresh.lat !== location.lat || fresh.lng !== location.lng) {
          setRefreshing(false);
          return;
        }
        lat = fresh.lat;
        lng = fresh.lng;
        source = fresh.source;
      }
    } catch {
      // Keep the selected coordinates if GPS refresh fails.
    }
    if (refreshContext !== currentContext.current) { setRefreshing(false); return; }
    await doFetch(inputs, lat, lng, query, source, true);
  }, [
    doFetch,
    canSearch,
    inputs,
    location,
    query,
  ]);
  const handleEndReached = useCallback(async () => {
    if (!canSearch || loading || completedContext !== currentContext.current) return;
    if (locked) return;
    if (nextCursor === null) return;
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setLoadingMore(true);
    const generation = fetchGeneration.current;
    const controller = new AbortController();
    pageController.current = controller;
    const pageContext = currentContext.current;
    const cursorBeingFetched = nextCursor;
    const pageIndex = pagesLoadedRef.current;
    const params = buildDiscoveryParams(inputs, location.lat, location.lng, query);
    params.cursor = cursorBeingFetched;
    try {
      const { data, nextCursor: cursor, locked: isLocked, networkError, restartRequired } = await fetchRestaurantsPage(params, { signal: controller.signal });
      if (generation !== fetchGeneration.current || pageContext !== currentContext.current) return;
      if (restartRequired) {
        // A changed entitlement can invalidate this cursor without changing
        // the typed query. Replace the list; never append another context.
        await doFetch(inputs, location.lat, location.lng, query, location.source);
        return;
      }
      if (networkError) throw new Error('Next page unavailable');
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
      if (generation !== fetchGeneration.current) return;
      isLoadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [
    query,
    canSearch,
    inputs,
    location.lat,
    location.lng,
    location.source,
    nextCursor,
    locked,
    loading,
    completedContext,
    doFetch,
  ]);
  useEffect(() => {
    requestController.current?.abort();
    pageController.current?.abort();
    fetchGeneration.current++;
    isLoadingMoreRef.current = false;
    setLoadingMore(false);
    setRefreshing(false);
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
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); requestController.current?.abort(); };
  }, [inputs, location.lat, location.lng, location.loading, location.source, query, canSearch, doFetch, targetsLoaded, previewReady]);
  useEffect(() => () => { requestController.current?.abort(); pageController.current?.abort(); fetchGeneration.current++; }, []);
  const pending = canSearch && completedContext !== contextKey;
  return { results, nextCursor, loading: canSearch && (loading || pending), loadingMore, refreshing,
    error: pending ? null : error, locked, fetchSeq, outOfArea: !pending && outOfArea,
    nearbyDishCount: pending ? undefined : nearbyDishCount, doFetch, handleRefresh, handleEndReached };
}
