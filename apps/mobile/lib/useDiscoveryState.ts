import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, type View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import type { RestaurantResult } from '@fitsy/shared';
import type { CoachMarkStep } from '@/components/CoachMarks';
import type { MacroValues } from './macroPresets';
import type { PresetLocation } from './locations';
import { usePreviewTour } from './usePreviewTour';
import { usePreviewSearchDemo } from './usePreviewSearchDemo';
import { useDiscoveryResults } from './useDiscoveryResults';
import { useDiscoveryLocation } from './useDiscoveryLocation';
import { useEntitlementMismatch } from './useEntitlementMismatch';
import { usePurchases } from './usePurchases';
import { routeToPaywall } from './teaserGate';
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
  const tourLocationRef = useRef<View | null>(null);
  const tourMoreRef = useRef<View | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
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
  const tourEnabled = isOnboardingPreview && locked === true && !filterVisible && !locationPickerVisible;
  const tour = usePreviewTour(tourEnabled && !loading && !error && results.length > 0, tourEnabled);
  const demo = usePreviewSearchDemo(tour.visible, setQuery);
  const { cancel: cancelDemo, editQuery } = demo;
  const { finish: finishPreviewTour } = tour;
  const finishTour = useCallback(() => { cancelDemo(); finishPreviewTour(); }, [cancelDemo, finishPreviewTour]);
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
    if (loading || error) return;
    finishTour();
    try {
      await saveOnboardingField('previewArea', `${location.lat}:${location.lng}`);
      await saveOnboardingField('previewCraving', query.trim());
      await routeToPaywall({ intent: {
        action: restaurant ? 'menu' : 'discovery', restaurantId: restaurant?.id,
        menuItemId: restaurant?.bestMatch?.menuItemId, mealName: restaurant?.bestMatch?.name,
        restaurantName: restaurant?.name, photoUrl: restaurant?.photoUrl,
        nearbyRestaurants: results.filter(r => r.id !== restaurant?.id).slice(0, 2).map(r => ({ id: r.id, name: r.name, photoUrl: r.photoUrl })),
        area: { lat: location.lat, lng: location.lng }, targets: inputs,
        areaName: location.name, query: query.trim(),
      } });
    } catch { Alert.alert('Could not open plans', 'Please try again. Your picks are still here.'); }
  }, [location.lat, location.lng, location.name, query, finishTour, inputs, results, loading, error]);
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
  const handleClearQuery = useCallback(() => editQuery(''), [editQuery]);
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
  const tourSteps: CoachMarkStep[] = useMemo(() => { const steps: CoachMarkStep[] = [
    {
      key: 'macros',
      title: 'Your meal targets',
      body: 'Your targets are for one meal. Tap Edit any time to change the numbers and explore different picks.',
      target: tourEditRef,
    },
    {
      key: 'search',
      title: 'Follow your craving',
      body: 'Let’s try pizza. Fitsy checks nearby menus against your meal targets. Then try any craving or restaurant of your own.',
      target: tourSearchRef,
      nextDisabled: demo.typing || loading,
    },
    {
      key: 'restaurant',
      title: error ? 'Your search can try again' : results.length === 0 ? 'Make room for your craving' : 'Real meals. Know the source.',
      body: error ? 'The search could not finish. Close the tour and tap Try again. Your craving and targets are still here.' : results.length === 0 ? 'We have no meals for this craving here yet. Try another dish or area. Your meal targets stay saved.' : 'Your targets rank these meals by closeness. Compare the macros, then open a full menu with Pro to check dishes and nutrition sources.',
      target: error ? tourSearchRef : results.length === 0 ? tourEditRef : tourHeroRef,
      placement: 'above',
    },
  ];
    // Demonstrate the craving before anchoring to its newly fetched restaurant.
    const preferred = onboardingPitch(tried).firstTip;
    const first = preferred === 'restaurant' ? 'search' : preferred;
    return [...steps.filter(step => step.key === first), ...steps.filter(step => step.key !== first),
      { key: 'location', title: 'Wherever your day takes you', body: 'Eating near work or meeting friends? Change your area here to find meals where you want to eat.', target: tourLocationRef },
      { key: 'more', title: results.length === 0 ? 'Keep exploring.' : 'Explore full menus.', body: results.length === 0 ? 'Try another dish or area. Your targets stay saved. Unlock full menus with Pro when you find a meal.' : 'Explore full menus with Pro. Try your first craving now.', target: tourMoreRef, placement: 'above' as const },
    ]; }, [tried, results, demo.typing, loading, error]);

  return { navigation, isOnboardingPreview, tried, inputs, query, setQuery: demo.editQuery, canSearch, hasQuery, location,
    locationLabel, results, heroResult, listResults, nextCursor, loading, loadingMore, refreshing, error, locked, outOfArea, nearbyDishCount,
    filterVisible, setFilterVisible, locationPickerVisible, setLocationPickerVisible, tourVisible: tour.visible, startTour: tour.start,
    tourEditRef, tourSearchRef, tourHeroRef, tourLocationRef, tourMoreRef, tourSteps, finishTour, tourStepShown: demo.showStep, cancelTourTyping: demo.cancel, handleClearQuery, handleApplyFilters,
    handleJoinWaitlist, handleOpenLocationPicker, handlePickLocation, handleUseCurrentLocation, unlockPreview,
    unlocking, resyncNow, onLockedTap, unlockTitle, unlockSubtitle, unlockLabel, handleRefresh, handleEndReached };
}
