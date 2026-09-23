import React, { useCallback, useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WelcomeNav } from './WelcomeNav';
import { router } from 'expo-router';
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
import { Masthead, MacroStrip, SearchBar } from './DiscoveryChrome';
import { HeroCard, RestaurantSection } from './DiscoveryCards';
const FREE_RESULT_COUNT = 3;
export function DiscoveryScreen({ onboardingPreview = false }: { onboardingPreview?: boolean }) {
  const { navigation, isOnboardingPreview, tried, inputs, query, setQuery, canSearch, hasQuery, location,
    locationLabel, results, heroResult, listResults, nextCursor, loading, loadingMore, refreshing, error, locked, outOfArea, goalMatch,
    filterVisible, setFilterVisible, locationPickerVisible, setLocationPickerVisible, tourVisible, startTour,
    tourEditRef, tourSearchRef, tourHeroRef, tourLocationRef, tourMoreRef, tourSteps, finishTour, tourStepShown, cancelTourTyping, handleClearQuery, handleApplyFilters,
    handleJoinWaitlist, handleOpenLocationPicker, handlePickLocation, handleUseCurrentLocation, unlockPreview,
    unlocking, resyncNow, onLockedTap, unlockTitle, unlockSubtitle, unlockLabel, handleRefresh, handleEndReached } = useDiscoveryState({ onboardingPreview });
  const listRef = useRef<FlatList<(typeof results)[number]>>(null);
  const scrollOffset = useRef(0);
  const viewportRef = useRef<View>(null);
  const prepareTourStep = useCallback((step: CoachMarkStep) => new Promise<void>(resolve => {
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
  }), []);
  const closeTour = () => { finishTour(); listRef.current?.scrollToOffset({ offset: 0, animated: false }); };
  const header = (
    <>
      {isOnboardingPreview && <View style={s.previewIntro} testID="preview-guide">
        <Text style={s.previewHint}>{onboardingPitch(tried).preview}</Text>
        {!loading && !error && results.length > 0 && <Pressable onPress={startTour} style={s.previewTourButton} accessibilityRole="button" accessibilityLabel="Show me how Fitsy works" accessibilityHint="Replay the five preview tips" testID="preview-show-tour">
          <Ionicons name="help-circle-outline" size={20} color={EDITORIAL.green} />
        </Pressable>}
      </View>}
      <MacroStrip macros={inputs} onEdit={() => setFilterVisible(true)} editRef={tourEditRef} />
      <SearchBar value={query} onChangeText={setQuery} onClear={handleClearQuery} containerRef={tourSearchRef} />
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
          <Text style={s.inlineEmptyText}>{hasQuery ? 'No matches for this search' : 'No meals close to these targets'}</Text>
          <Text style={s.inlineEmptyHint}>
            {hasQuery ? 'We checked your craving and every active meal target. Try another search or adjust your targets.' : 'Try adjusting one or more meal targets to see more options.'}
          </Text>
          <Pressable testID="discovery-empty-edit" accessibilityRole="button" style={s.waitlistBtn} onPress={() => setFilterVisible(true)}><Text style={s.waitlistBtnText}>Adjust meal targets</Text></Pressable>
          {hasQuery && <Pressable testID="discovery-empty-clear" accessibilityRole="button" style={s.waitlistBtn} onPress={handleClearQuery}><Text style={s.waitlistBtnText}>Clear search</Text></Pressable>}
        </View>
      )}
      {canSearch && !loading && heroResult && <HeroCard result={heroResult} locked={locked === true && !isOnboardingPreview} unlocking={onLockedTap} containerRef={tourHeroRef} onOpen={isOnboardingPreview ? () => { void unlockPreview(heroResult); } : undefined} />}
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
      return <View ref={tourMoreRef} collapsable={false}><LockedUnlockCard title="More choices. Full menus." subtitle={goalMatch && goalMatch.matchingDishCount > results.length ? `${(goalMatch.matchingDishCount - results.length).toLocaleString()} more meals close to your targets. Explore full menus with Pro.` : 'Explore full menus and find more ways to eat toward your goals.'}
        ctaLabel="Explore meals that fit" accessibilityLabel="Explore more meals and full menus with Pro" onPress={() => { void unlockPreview(); }} style={s.lockedCard} /></View>;
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
  }, [loadingMore, locked, results.length, hiddenCount, nextCursor, unlocking, resyncNow, unlockTitle, unlockSubtitle, unlockLabel, isOnboardingPreview, goalMatch, unlockPreview, loading, error, outOfArea, tourMoreRef]);
  return (
    <SafeAreaView
      edges={isOnboardingPreview ? ['top', 'right', 'bottom', 'left'] : ['top', 'right', 'left']}
      style={{ flex: 1, backgroundColor: EDITORIAL.cream }}
    >
      {isOnboardingPreview && <WelcomeNav progress={0.75} backTestID="preview-back" onBack={navigation.canGoBack() ? () => router.back() : undefined} />}
      <Masthead preview={isOnboardingPreview} locationRef={tourLocationRef} locationLabel={locationLabel} onLocationPress={handleOpenLocationPicker} />
      {!loading && error !== null && (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={() => { void handleRefresh(); }} accessibilityRole="button" testID="preview-retry"><Text style={s.previewLink}>Try again</Text></Pressable>
        </View>
      )}
      <View ref={viewportRef} collapsable={false} style={{ flex: 1 }}><FlatList
          ref={listRef}
          onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
          // The tab navigator occupies its own layout space below this list.
          contentContainerStyle={{ paddingBottom: 28 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          data={canSearch && !loading ? (locked ? listResults.slice(0, FREE_RESULT_COUNT - 1) : listResults) : []}
          keyExtractor={(r) => r.id}
          renderItem={({ item, index }) => (
            <RestaurantSection result={item} index={index} hideDishName={isOnboardingPreview} locked={locked === true && !isOnboardingPreview} unlocking={onLockedTap} onOpen={isOnboardingPreview ? () => { void unlockPreview(item); } : undefined} />
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
      <CoachMarks
        visible={tourVisible && locked === true}
        steps={tourSteps}
        onDone={closeTour}
        onBeforeStep={prepareTourStep}
        onStepLeaving={cancelTourTyping}
        doneLabel="Find my meal"
        onStepShown={(step) => { tourStepShown(step.key); trackOnboardingScreenView(`preview_tour_${step.key}`); }}
      />
      <FilterPopup
        visible={filterVisible}
        values={inputs}
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
    </SafeAreaView>
  );
}
