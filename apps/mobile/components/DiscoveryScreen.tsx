import React, { Suspense, useCallback, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WelcomeNav } from './WelcomeNav';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DiscoveryLoading } from './DiscoveryLoading';
import { LockedUnlockCard } from './LockedUnlockCard';
import { CoachMarks, type CoachMarkStep } from './CoachMarks';
import { FilterPopup } from './FilterPopup';
import { LocationPickerSheet } from './LocationPickerSheet';
import { EDITORIAL } from '@/lib/brand';
import { onboardingPitch } from '@/lib/onboardingPersonalization';
import { routeToPaywall } from '@/lib/teaserGate';
import { trackOnboardingScreenView } from '@/lib/analytics';
import { useDiscoveryState } from '@/lib/useDiscoveryState';
import { s } from './DiscoveryScreen.styles';
import { Masthead, MacroStrip, SearchBar, DiscoveryToolbar } from './DiscoveryChrome';
import { HeroCard, PreviewTourButton, RestaurantSection } from './DiscoveryCards';
import { useMapSearchFlag } from '@/lib/useMapSearchFlag';
import { useFloatingNavClearance } from '@/lib/floatingNav';
import { DiscoveryViewToggle } from './DiscoveryViewToggle';
const SHEET_SLIDE_MS = 280;
// Load the native map only on eligible iOS entries.
const DiscoveryMap = React.lazy(async () => require('./DiscoveryMap') as typeof import('./DiscoveryMap'));
const FREE_RESULT_COUNT = 3;
export function DiscoveryScreen({ onboardingPreview = false, onPreviewBack }: { onboardingPreview?: boolean; onPreviewBack?: () => void }) {
  const tabBarClearance = useFloatingNavClearance();
  const { mapDebug } = useLocalSearchParams<{ mapDebug?: string }>();
  // The onboarding preview is map-first by product requirement, not by experiment
  // rollout: it must not wait on the async remote flag a Debug/test-store build
  // may never resolve before the real "Continue" navigation lands here.
  const mapEnabled = useMapSearchFlag(mapDebug === '1' || onboardingPreview);
  const [view, setView] = useState<'map' | 'list'>('map');
  const showMap = mapEnabled && view === 'map';
  // The list rides up over the map as a full-screen sheet, and back down to
  // reveal it - map stays mounted underneath the whole time (#829), so the
  // swipe never flickers or reloads it. sheetY is in screen points: 0 = the
  // sheet fully covers the map (list showing), windowHeight = fully hidden
  // below the bottom edge (map showing).
  const { height: windowHeight } = useWindowDimensions();
  const sheetY = useSharedValue(windowHeight);
  // The view switch itself is synchronous (so callers can rely on the new
  // screen being mounted immediately after calling this); only the slide is
  // animated, as a lightweight transition rather than a hard cut.
  const switchView = useCallback((next: 'map' | 'list') => {
    setView(next);
    if (mapEnabled) {
      sheetY.value = withTiming(next === 'list' ? 0 : windowHeight,
        { duration: SHEET_SLIDE_MS, easing: Easing.out(Easing.cubic) });
    }
  }, [mapEnabled, sheetY, windowHeight]);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const discovery = useDiscoveryState({ onboardingPreview });
  const { navigation, isOnboardingPreview, tried, inputs, filterMode, query, setQuery, canSearch, hasQuery, location,
    locationLabel, results, heroResult, listResults, nextCursor, loading, loadingMore, refreshing, error, locked, outOfArea,
    filterVisible, setFilterVisible, locationPickerVisible, setLocationPickerVisible, tourReady, tourVisible, startTour,
    tourEditRef, tourSearchRef, tourHeroRef, tourLocationRef, tourMoreRef, tourSteps, finishTour, tourStepShown, cancelTourTyping, handleClearQuery, handleApplyFilters,
    handleJoinWaitlist, handleOpenLocationPicker, handlePickLocation, handleUseCurrentLocation, unlockPreview,
    unlocking, resyncNow, onLockedTap, unlockTitle, unlockSubtitle, unlockLabel, handleRefresh, handleEndReached, canShuffle, handleShuffle } = discovery;
  const listRef = useRef<FlatList<(typeof results)[number]>>(null);
  const scrollOffset = useRef(0);
  const viewportRef = useRef<View>(null);
  const [tourLayoutVersion, refreshTourLayout] = useReducer((version: number) => version + 1, 0);
  const onTourLayoutChange = () => { if (tourVisible) refreshTourLayout(); };
  const prepareTourStep = useCallback((step: CoachMarkStep) => new Promise<void>(resolve => {
    if (showMap) { resolve(); return; }
    // The location chip is fixed above the list; all other anchors scroll with it.
    if (step.key === 'location') { resolve(); return; }
    const timer = setTimeout(resolve, 250);
    step.target.current?.measureInWindow((_x, y, _w, h) => {
      viewportRef.current?.measureInWindow((_vx, vy, _vw, vh) => {
        const top = Math.max(vy + 12, Math.min(y, vy + vh - h - 24));
        listRef.current?.scrollToOffset({ offset: Math.max(0, scrollOffset.current + y - top), animated: false });
        clearTimeout(timer);
        setTimeout(resolve, 100);
      });
    });
  }), [showMap]);
  const closeTour = () => { finishTour(); listRef.current?.scrollToOffset({ offset: 0, animated: false }); };
  const renderSearchBar = (action?: React.ReactNode) => <SearchBar value={query} onChangeText={setQuery} onClear={handleClearQuery} containerRef={tourSearchRef} action={action} frosted={mapEnabled} />;
  const previewGoBack = onPreviewBack ?? (navigation.canGoBack() ? () => router.back() : undefined);
  // The map preview is the real map screen, not an onboarding step: no
  // progress-bar chrome there, just a small back control inline with the tip.
  const previewNav = isOnboardingPreview && !showMap && <WelcomeNav progress={0.75} backTestID="preview-back" onBack={previewGoBack} />;
  const previewIntro = isOnboardingPreview && <View style={s.previewIntro} testID="preview-guide">
    {showMap && previewGoBack && <Pressable onPress={previewGoBack} style={s.previewMapBack} accessibilityRole="button" accessibilityLabel="Go back" testID="preview-back">
      <Ionicons name="chevron-back" size={20} color={EDITORIAL.textMid} />
    </Pressable>}
    <Text style={s.previewHint}>{onboardingPitch(tried).preview}</Text>
    {mapEnabled && !showMap && <DiscoveryViewToggle map={false} onPress={() => switchView('map')} />}
    <PreviewTourButton ready={tourReady} onPress={startTour} />
  </View>;
  const header = (
    <>
      {isOnboardingPreview && <>
        {previewIntro}
        <MacroStrip macros={inputs} onEdit={() => setFilterVisible(true)} editRef={tourEditRef} />
        {renderSearchBar()}
      </>}
      {!canSearch && (
        <View style={s.inlineEmpty}>
          <Ionicons name="search-outline" size={32} color={EDITORIAL.greenAccent} />
          <Text style={s.inlineEmptyText}>Find your next meal</Text>
          <Text style={s.inlineEmptyHint}>Search a restaurant or dish above, or tap Edit to set macro targets</Text>
        </View>
      )}
      {loading && <DiscoveryLoading />}
      {canSearch && !loading && outOfArea && (
        <View style={s.inlineEmpty}>
          <Ionicons name="leaf-outline" size={32} color={EDITORIAL.greenAccent} />
          <Text style={s.inlineEmptyText}>We're not in your area yet</Text>
          <Text style={s.inlineEmptyHint}>
            Fitsy is launching in Los Angeles first - your city is next on the list.
          </Text>
          <Pressable
            style={({ pressed }) => [s.waitlistBtn, pressed && s.waitlistBtnPressed]}
            testID="discovery-join-waitlist"
            onPress={handleJoinWaitlist}
            accessibilityRole="button"
            accessibilityLabel="Keep me posted"
          >
            <Text style={s.waitlistBtnText}>Keep me posted</Text>
          </Pressable>
        </View>
      )}
      {canSearch && !outOfArea && !loading && !error && results.length === 0 && (
        <View style={s.inlineEmpty}>
          <Ionicons name="search-outline" size={32} color={EDITORIAL.creamDeep} />
          <Text style={s.inlineEmptyText}>{hasQuery ? 'No matches for this search' : 'No meals with nutrition nearby'}</Text>
          <Text style={s.inlineEmptyHint}>
            {hasQuery ? 'Try another dish or restaurant, or search in a different area. Your meal targets stay saved.' : 'Try another area to find meals with nutrition information.'}
          </Text>
          <Pressable testID="discovery-empty-edit" accessibilityRole="button" style={s.waitlistBtn} onPress={() => setFilterVisible(true)}><Text style={s.waitlistBtnText}>Adjust meal targets</Text></Pressable>
          {hasQuery && <Pressable testID="discovery-empty-clear" accessibilityRole="button" style={s.waitlistBtn} onPress={handleClearQuery}><Text style={s.waitlistBtnText}>Clear search</Text></Pressable>}
        </View>
      )}
      {canSearch && !loading && heroResult && <HeroCard result={heroResult} locked={locked === true && !isOnboardingPreview} unlocking={onLockedTap} containerRef={tourHeroRef} onOpen={isOnboardingPreview ? unlockPreview : undefined} />}
      {canSearch && !loading && locked && !isOnboardingPreview && (results.length > 0) && (
        <Pressable
          style={s.lockedBanner}
          testID="search-value-cta"
          onPress={unlocking ? resyncNow : () => { void routeToPaywall(); }}
          accessibilityRole="button"
          accessibilityLabel={unlocking ? unlockLabel : 'Find meals that fit - view subscription plans'}
        >
          {unlocking
            ? <ActivityIndicator size="small" color={EDITORIAL.greenAccent} />
            : <Ionicons name="lock-closed" size={14} color={EDITORIAL.greenAccent} />}
          <Text style={s.lockedBannerText}>
            {unlocking
              ? `${unlockTitle} ${unlockSubtitle}`
              : 'Find meals that fit your macros. View plans →'}
          </Text>
        </Pressable>
      )}
    </>
  );
  const hiddenCount = results.length - FREE_RESULT_COUNT;
  const renderFooter = useCallback(() => {
    if (loading) return null;
    if (isOnboardingPreview && !loading && !error && !outOfArea) {
      const empty = results.length === 0;
      const title = empty ? 'Keep exploring.' : 'Explore full menus.';
      const subtitle = empty ? 'Try another dish or area. Unlock full menus with Pro.' : 'Explore full menus with Pro.';
      const ctaLabel = empty ? 'Explore Pro plans' : 'Explore full menus';
      return <View ref={tourMoreRef} collapsable={false}><LockedUnlockCard
        title={title}
        subtitle={subtitle}
        ctaLabel={ctaLabel}
        accessibilityLabel={`${title} ${subtitle} ${ctaLabel}`}
        onPress={() => { void unlockPreview(); }} style={s.lockedCard} /></View>;
    }
    if (locked && results.length > 0) {
      if (unlocking) {
        return (
          <LockedUnlockCard
            title={unlockTitle}
            subtitle={unlockSubtitle}
            onPress={resyncNow}
            ctaLabel="Refresh my subscription"
            accessibilityLabel={unlockLabel}
            style={s.lockedCard}
          />
        );
      }
      return (
        <LockedUnlockCard
          title={hiddenCount > 0 ? `${hiddenCount}${nextCursor ? '+' : ''} more restaurants` : 'Unlock every match near you'}
          subtitle="Find your next meal nearby, matched to your macros."
          onPress={() => { void routeToPaywall(); }}
          accessibilityLabel="Find meals that fit - view subscription plans"
          style={s.lockedCard}
        />
      );
    }
    if (!loadingMore) return null;
    return (
      <View style={s.footerSpinner}>
        <ActivityIndicator size="small" color={EDITORIAL.greenAccent} />
      </View>
    );
  }, [loadingMore, locked, results.length, hiddenCount, nextCursor, unlocking, resyncNow, unlockTitle, unlockSubtitle, unlockLabel, isOnboardingPreview, unlockPreview, loading, error, outOfArea, tourMoreRef]);
  const listContent = (
    <>
      {previewNav}
      {isOnboardingPreview
        ? <Masthead preview locationRef={tourLocationRef} locationLabel={locationLabel} onLocationPress={handleOpenLocationPicker} />
        : <DiscoveryToolbar query={query} onQueryChange={setQuery} onClear={handleClearQuery} searchRef={tourSearchRef}
            onMacrosPress={() => setFilterVisible(true)} canShuffle={canShuffle} onShuffle={handleShuffle}
            onViewToggle={mapEnabled ? () => switchView('map') : undefined} />}
      {!loading && error !== null && (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={() => { void handleRefresh(); }} accessibilityRole="button" testID="preview-retry"><Text style={s.previewLink}>Try again</Text></Pressable>
        </View>
      )}
      <View ref={viewportRef} collapsable={false} onLayout={onTourLayoutChange} style={{ flex: 1 }}><FlatList
          testID="discovery-list"
          ref={listRef}
          onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.y; onTourLayoutChange(); }}
          onContentSizeChange={onTourLayoutChange}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 28 + tabBarClearance }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          data={canSearch && !loading ? (locked ? listResults.slice(0, FREE_RESULT_COUNT - 1) : listResults) : []}
          keyExtractor={(r) => r.id}
          renderItem={({ item, index }) => (
            <RestaurantSection result={item} index={index} hideDishName={isOnboardingPreview} locked={locked === true && !isOnboardingPreview} unlocking={onLockedTap} onOpen={isOnboardingPreview ? unlockPreview : undefined} />
          )}
          ListHeaderComponent={header}
          ListFooterComponent={renderFooter}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={EDITORIAL.greenAccent}
              colors={[EDITORIAL.greenAccent]}
            />
          }
        /></View>
    </>
  );
  const listEdges = isOnboardingPreview ? (['top', 'right', 'bottom', 'left'] as const) : (['top', 'right', 'left'] as const);
  const overlays = (
    <>
      <CoachMarks
        visible={tourVisible && locked === true}
        steps={tourSteps}
        layoutVersion={tourLayoutVersion}
        onDone={closeTour}
        onBeforeStep={prepareTourStep}
        onStepLeaving={cancelTourTyping}
        doneLabel="Find my meal"
        onStepShown={(step) => { tourStepShown(step.key); trackOnboardingScreenView(`preview_tour_${step.key}`); }}
      />
      <FilterPopup
        visible={filterVisible}
        values={inputs}
        mode={filterMode}
        allowPartial
        onApply={handleApplyFilters}
        onClose={() => setFilterVisible(false)}
      />
      <LocationPickerSheet
        visible={locationPickerVisible}
        activeName={location.source === 'manual' ? location.name : undefined}
        onPick={(loc) => {
          handlePickLocation(loc);
          setLocationPickerVisible(false);
        }}
        onUseCurrent={() => {
          handleUseCurrentLocation();
          setLocationPickerVisible(false);
        }}
        onClose={() => setLocationPickerVisible(false)}
      />
    </>
  );
  if (!mapEnabled) {
    return (
      <SafeAreaView testID="discovery-screen" edges={listEdges} style={{ flex: 1, backgroundColor: EDITORIAL.cream }}>
        {listContent}
        {overlays}
      </SafeAreaView>
    );
  }
  // The map stays mounted at all times here - the list rides over it as a
  // full-screen sheet that slides up/down (#829), instead of mounting one
  // screen or the other, so toggling never flickers or reloads the map.
  return (
    <View testID="discovery-screen" style={{ flex: 1, backgroundColor: EDITORIAL.cream }}>
      <View style={{ flex: 1 }} collapsable={false}
        accessibilityElementsHidden={view === 'list'} importantForAccessibility={view === 'list' ? 'no-hide-descendants' : 'auto'}>
        <Suspense fallback={<ActivityIndicator accessibilityLabel="Loading map" />}>
          <DiscoveryMap discovery={discovery} onShowList={() => switchView('list')}
            previewHeader={isOnboardingPreview ? <>{previewNav}{previewIntro}</> : undefined}
            onTourLayoutChange={onTourLayoutChange} />
        </Suspense>
      </View>
      <Animated.View testID="discovery-sheet" style={[s.listSheet, sheetStyle]} pointerEvents={view === 'list' ? 'auto' : 'none'}
        accessibilityElementsHidden={view === 'map'} importantForAccessibility={view === 'map' ? 'no-hide-descendants' : 'auto'}>
        <SafeAreaView edges={listEdges} style={{ flex: 1, backgroundColor: EDITORIAL.cream }}>
          {listContent}
        </SafeAreaView>
      </Animated.View>
      {overlays}
    </View>
  );
}
