import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, type View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import type { RestaurantResult } from '@fitsy/shared';
import type { CoachMarkStep } from '@/components/CoachMarks';
import type { MacroValues } from './macroPresets';
import type { PresetLocation } from './locations';
import { useDiscoveryResults } from './useDiscoveryResults';
import { useDiscoveryLocation } from './useDiscoveryLocation';
import { useEntitlementMismatch } from './useEntitlementMismatch';
import { usePurchases } from './usePurchases';
import { hasSeenPreviewTour, markPreviewTourSeen, routeToPaywall } from './teaserGate';
import { getMacroTargets, saveMacroTargets } from './macroStorage';
import { getPreviewSetup } from './previewSetup';
import { saveOnboardingField } from './onboardingStorage';
import { onboardingPitch, type TriedApproach } from './onboardingPersonalization';
import { useOnboardingStep } from './onboardingResume';
import { clearPaywallIntent } from './paywallIntent';
import { trackOnboardingScreenView, trackLocationManualOverrideOpened, trackLocationManualOverridePicked, trackLocationManualOverrideCleared, trackSaveMacroTargetsFailed, trackMacroTargetsEdited } from './analytics';
const DEFAULT_INPUTS: MacroValues = { protein: '', carbs: '', fat: '', calories: '' };
export function useDiscoveryState({ onboardingPreview = false }: { onboardingPreview?: boolean }) {
  const { query: initialQuery } = useLocalSearchParams<{ query?: string }>();
  const isOnboardingPreview = onboardingPreview;
  const navigation = useNavigation();
  useOnboardingStep(isOnboardingPreview ? 'preview' : undefined);
  const [tried, setTried] = useState<TriedApproach>();
  const [previewReady, setPreviewReady] = useState(!isOnboardingPreview);
  useEffect(() => {
    if (isOnboardingPreview) trackOnboardingScreenView('results');
  }, [isOnboardingPreview]);
  const [inputs, setInputs] = useState<MacroValues>(DEFAULT_INPUTS);
  const { entitled, isPro, syncEntitlement, storeConfirmed } = usePurchases();
  const tourEditRef = useRef<View | null>(null);
  const tourSearchRef = useRef<View | null>(null);
  const tourHeroRef = useRef<View | null>(null);
  const [tourVisible, setTourVisible] = useState(false);
  const tourDoneRef = useRef(false);
  const tourStartingRef = useRef(false);
  const screenFocusedRef = useRef(false);
  const overlayOpenRef = useRef(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  overlayOpenRef.current = filterVisible || locationPickerVisible;
  const [query, setQuery] = useState(initialQuery ?? '');
  const location = useDiscoveryLocation(isOnboardingPreview);
  function handleOpenLocationPicker() {
    trackLocationManualOverrideOpened();
    setLocationPickerVisible(true);
  }
  function handlePickLocation(loc: PresetLocation) {
    trackLocationManualOverridePicked({ neighborhood: loc.name });
    location.setManualLocation(loc).catch(() => Alert.alert('Could not change area', 'Please try again. Your previous area is still selected.'));
  }
  function handleUseCurrentLocation() {
    trackLocationManualOverrideCleared();
    location.clearManualLocation().catch(() => Alert.alert('Location unavailable', 'Choose a neighborhood instead, or try again.'));
  }
  const hasInputs =
    inputs.protein !== '' || inputs.carbs !== '' || inputs.fat !== '' || inputs.calories !== '';
  const hasQuery = query.trim() !== '';
  const canSearch = (hasInputs || hasQuery || isOnboardingPreview) && previewReady;
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  const discovery = useDiscoveryResults({ inputs, query, location, canSearch, targetsLoaded, previewReady, isOnboardingPreview });
  const { results, nextCursor, loading, loadingMore, refreshing, error, locked, fetchSeq, outOfArea, nearbyDishCount, doFetch, handleRefresh, handleEndReached } = discovery;
  const lockedRef = useRef<boolean | null>(null);
  lockedRef.current = locked;
  useFocusEffect(
    useCallback(() => {
      screenFocusedRef.current = true;
      return () => { screenFocusedRef.current = false; };
    }, []),
  );
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
          // eslint-disable-next-line no-console
          console.warn('[search] getMacroTargets failed:', err);
        })
        .finally(() => setTargetsLoaded(true));
    }, []),
  );
  useFocusEffect(useCallback(() => {
    if (!isOnboardingPreview) return;
    let live = true;
    void clearPaywallIntent().catch(() => undefined);
    void getPreviewSetup().then(({ data }) => {
      if (!live) return;
      setTried(data.tried);
      const key = data.area ? `${data.area.lat}:${data.area.lng}` : '';
      setQuery(data.previewArea === key ? data.previewCraving ?? '' : '');
      setPreviewReady(true);
    });
    return () => { live = false; };
  }, [isOnboardingPreview]));
  const unlockPreview = useCallback(async (restaurant?: RestaurantResult) => {
    markPreviewTourSeen();
    try {
      await saveOnboardingField('previewArea', `${location.lat}:${location.lng}`);
      await saveOnboardingField('previewCraving', query.trim());
      await routeToPaywall({ intent: {
        action: restaurant ? 'menu' : 'discovery', restaurantId: restaurant?.id,
        menuItemId: restaurant?.bestMatch?.menuItemId, mealName: restaurant?.bestMatch?.name,
        areaName: location.name, nearbyDishCount, query: query.trim(),
      } });
    } catch { Alert.alert('Could not open plans', 'Please try again. Your picks are still here.'); }
  }, [location.lat, location.lng, location.name, nearbyDishCount, query]);
  const mismatchArgsRef = useRef({ inputs, location, query, doFetch });
  mismatchArgsRef.current = { inputs, location, query, doFetch };
  const mismatchRefetch = useCallback(() => {
    const { inputs: current, location: loc, query: q, doFetch: run } = mismatchArgsRef.current;
    void run(current, loc.lat, loc.lng, q, loc.source, true);
  }, []);
  useEntitlementMismatch({ entitled, isPro, locked, fetchSeq, syncEntitlement, refetch: mismatchRefetch });
  const unlocking = entitled === true && locked === true;
  const resyncNow = useCallback(() => {
    void syncEntitlement('mismatch').then(() => mismatchRefetch());
  }, [syncEntitlement, mismatchRefetch]);
  const onLockedTap = unlocking ? resyncNow : undefined;
  const unlockTitle = storeConfirmed ? 'Unlocking your subscription...' : 'Checking your subscription...';
  const unlockSubtitle = storeConfirmed
    ? 'Your purchase went through. Tap to refresh if this takes more than a moment.'
    : 'Tap to refresh.';
  const unlockLabel = `${unlockTitle} tap to refresh`;
  const persistMacroTargets = useCallback((values: MacroValues) => {
    saveMacroTargets(values).catch((err: unknown) => {
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
    router.push(isOnboardingPreview ? '/welcome/out-of-area' : '/welcome/signin?outOfArea=1');
  }, [isOnboardingPreview]);
  const locationLabel = location.loading
    ? 'Locating...'
    : isOnboardingPreview && location.name ? location.name : location.source === 'gps'
      ? 'Near You'
      : location.source === 'manual'
        ? location.name ?? 'Manual'
        : 'Silver Lake, LA';
  const [heroResult, ...listResults] = results;
  useEffect(() => {
    if (!isOnboardingPreview || locked !== true || loading || results.length === 0) return;
    if (tourDoneRef.current || tourStartingRef.current) return;
    tourStartingRef.current = true;
    void hasSeenPreviewTour().then((seen) => {
      if (seen) {
        tourDoneRef.current = true;
        return;
      }
      setTimeout(() => {
        tourStartingRef.current = false;
        const ok = lockedRef.current === true && screenFocusedRef.current && !overlayOpenRef.current;
        if (!ok) return;
        tourDoneRef.current = true;
        setTourVisible(true);
      }, 600);
    });
  }, [isOnboardingPreview, locked, loading, results.length]);
  useEffect(() => {
    if (locked !== true) setTourVisible(false);
  }, [locked]);
  const finishTour = useCallback(() => {
    markPreviewTourSeen();
    setTourVisible(false);
  }, []);
  const tourSteps: CoachMarkStep[] = useMemo(() => { const steps: CoachMarkStep[] = [
    {
      key: 'macros',
      title: 'Your meal targets',
      body: 'Tap Edit to change calories, protein, carbs and fat for one meal. Your picks update to match.',
      target: tourEditRef,
    },
    {
      key: 'search',
      title: 'Search anything',
      body: 'Type a dish or a restaurant name to narrow down what is nearby.',
      target: tourSearchRef,
    },
    {
      key: 'restaurant',
      title: 'Real meals. Clear numbers.',
      body: 'Explore three picks and their nutrition sources. Tap a restaurant to see plans for its full menu.',
      target: tourHeroRef,
      placement: 'above',
    },
  ]; const first = onboardingPitch(tried).firstTip; return [...steps.filter(step => step.key === first), ...steps.filter(step => step.key !== first)]; }, [tried]);

  return { navigation, isOnboardingPreview, tried, inputs, query, setQuery, canSearch, hasQuery, location,
    locationLabel, results, heroResult, listResults, nextCursor, loading, loadingMore, refreshing, error, locked, outOfArea, nearbyDishCount,
    filterVisible, setFilterVisible, locationPickerVisible, setLocationPickerVisible, tourVisible, setTourVisible,
    tourEditRef, tourSearchRef, tourHeroRef, tourSteps, finishTour, handleClearQuery, handleApplyFilters,
    handleJoinWaitlist, handleOpenLocationPicker, handlePickLocation, handleUseCurrentLocation, unlockPreview,
    unlocking, resyncNow, onLockedTap, unlockTitle, unlockSubtitle, unlockLabel, handleRefresh, handleEndReached };
}
