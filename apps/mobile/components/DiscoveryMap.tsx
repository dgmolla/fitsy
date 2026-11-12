import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import type { RestaurantResult } from '@fitsy/shared';
import type { useDiscoveryState } from '@/lib/useDiscoveryState';
import { EDITORIAL } from '@/lib/brand';
import { hasMapCoordinate, mapCuisineEmoji, mapRestaurantLabel } from '@/lib/discoveryMap';
import { trackRestaurantTapped } from '@/lib/analytics';
import { FrostedSearchSurface } from './DiscoveryChrome';
import { openRestaurantOrPaywall } from './DiscoveryCards';
import { DiscoveryMapCard } from './DiscoveryMapCard';
import { ShuffleButton } from './ShuffleButton';
import { s } from './DiscoveryMap.styles';
import { useFloatingNavClearance } from '@/lib/floatingNav';

type Discovery = ReturnType<typeof useDiscoveryState>;
type PinStyle = 'numbered' | 'utensils' | 'cuisine' | 'icon';
const DELTA = { latitudeDelta: 0.09, longitudeDelta: 0.09 };
const PIN_STYLES = [['numbered', '01', 'Numbers'], ['utensils', '🍴', 'Utensils'], ['cuisine', '🌮', 'Cuisine'], ['icon', '', 'Icon']] as const;

// Snapshot only paint/selection changes, with no asynchronous image in a marker.
const RestaurantMarker = React.memo(function RestaurantMarker({ result, position, selected, pinStyle, onSelect }: {
  result: RestaurantResult; position: number; selected: boolean; pinStyle: PinStyle; onSelect: (result: RestaurantResult) => void;
}) {
  const symbol = pinStyle === 'cuisine' ? mapCuisineEmoji(result) : pinStyle === 'utensils' ? '🍴' : String(position + 1).padStart(2, '0');
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true);
    const timer = setTimeout(() => setTracking(false), 250);
    return () => clearTimeout(timer);
  }, [selected, symbol, pinStyle, result.name]);
  return <Marker identifier={result.id} coordinate={{ latitude: result.lat, longitude: result.lng }}
    anchor={{ x: 0.5, y: 0.5 }} stopPropagation tracksViewChanges={tracking}
    zIndex={selected ? 1000 : 100 - position} testID={`map-pin-${position}`}
    accessibilityRole="button" accessibilityLabel={mapRestaurantLabel(result)}
    accessibilityHint="Select restaurant card" accessibilityState={{ selected }} onPress={() => onSelect(result)}>
    <View style={[s.pin, pinStyle !== 'numbered' && s.emojiPin, selected && s.selectedPin]} collapsable={false}>
      {pinStyle === 'icon' ? <Ionicons name="restaurant-outline" size={24} color={EDITORIAL.green} />
        : <Text style={[pinStyle === 'numbered' ? s.pinNumber : s.pinEmoji, selected && pinStyle === 'numbered' && s.selectedPinNumber]}>{symbol}</Text>}
    </View>
  </Marker>;
});

// Loaded only when the iOS Discovery map is selected.
export default function DiscoveryMap({ discovery: d, onShowList, previewHeader, onTourLayoutChange }: {
  discovery: Discovery; onShowList: () => void; previewHeader?: React.ReactNode; onTourLayoutChange?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const tabBarClearance = useFloatingNavClearance();
  const bottomClearance = d.isOnboardingPreview ? insets.bottom : tabBarClearance;
  const { width, height } = useWindowDimensions();
  // The owner chose C alternate. Historical mapTray/mapVariant links cannot
  // restore retired layouts; only the orthogonal pin treatment is selectable.
  const { mapPin } = useLocalSearchParams<{ mapPin?: string }>();
  const pinStyle: PinStyle = mapPin === 'numbered' || mapPin === 'cuisine' || mapPin === 'icon' ? mapPin : 'utensils';
  const map = useRef<MapView>(null);
  const carousel = useRef<ScrollView>(null);
  const [mapRevision, setMapRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [trayHeight, setTrayHeight] = useState(220);
  const [topHeight, setTopHeight] = useState(104);
  const [layoutHeight, setLayoutHeight] = useState(height);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const panning = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const [pendingArea, setPendingArea] = useState<{ lat: number; lng: number } | null>(null);
  const cardWidth = width - 56;
  const stride = cardWidth + 12;
  const compact = height < 740;
  const controlsBottom = insets.top + 8 + topHeight;
  const maxTrayHeight = Math.max(160, layoutHeight - controlsBottom - bottomClearance - 96);
  // Match the list's free-result boundary and preserve rows without coordinates.
  // The preview appends one real, locked card teasing the paid tier, when the
  // area has a fourth nearby restaurant to show (lockedTeaser is null otherwise).
  const cards = useMemo(() => d.canSearch && !d.loading
    ? (d.isOnboardingPreview ? (d.lockedTeaser ? [...d.results.slice(0, 3), d.lockedTeaser] : d.results.slice(0, 3))
      : d.locked ? d.results.slice(0, 3) : d.results) : [],
    [d.canSearch, d.loading, d.locked, d.isOnboardingPreview, d.results, d.lockedTeaser]);
  const pins = useMemo(() => cards.filter(hasMapCoordinate), [cards]);
  const index = cards.findIndex(result => result.id === selectedId);
  const fallback = !d.location.loading && d.location.source.startsWith('fallback-');
  const { lat, lng } = d.location;
  useEffect(() => { setPendingArea(null); panning.current = false; }, [lat, lng]);
  const firstId = cards[0]?.id;
  useEffect(() => {
    setSelectedId(undefined);
    carousel.current?.scrollTo({ x: 0, animated: false });
  }, [firstId, lat, lng, d.tourVisible]);
  useEffect(() => {
    if (!mapRevision || d.location.loading || pendingArea) return;
    // One camera writer, after measured layout. Do not also set mapPadding:
    // Apple Maps applies those layout margins in addition to this fitted inset.
    const frame = requestAnimationFrame(() => {
      // A touch may finish without a native region event. A later intentional
      // fit supersedes that gesture and must not be mistaken for an area pick.
      panning.current = false;
      if (!pins.length) {
        map.current?.animateToRegion({ latitude: lat, longitude: lng, ...DELTA }, 0);
        return;
      }
      const coordinates = pins.length === 1
        ? [{ latitude: pins[0].lat - 0.004, longitude: pins[0].lng - 0.004 },
          { latitude: pins[0].lat + 0.004, longitude: pins[0].lng + 0.004 }]
        : pins.map(result => ({ latitude: result.lat, longitude: result.lng }));
      map.current?.fitToCoordinates(coordinates, { edgePadding: {
        top: controlsBottom + 28, bottom: trayHeight + bottomClearance + 28, left: 32, right: 32,
      }, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [mapRevision, pins, controlsBottom, trayHeight, bottomClearance, layoutHeight, lat, lng, d.location.loading, pendingArea]);
  const restoreCarousel = useCallback(() => {
    // Refresh/error states unmount this view while retaining the selected row.
    carousel.current?.scrollTo({ x: Math.max(0, index) * stride, animated: false });
  }, [index, stride]);
  function select(result: RestaurantResult, scroll = true) {
    setSelectedId(result.id);
    if (scroll) {
      carousel.current?.scrollTo({ x: cards.findIndex(card => card.id === result.id) * stride, animated: true });
    }
  }
  function open(result: RestaurantResult) {
    trackRestaurantTapped({ restaurant_id: result.id, restaurant_name: result.name,
      position: cards.findIndex(card => card.id === result.id), entry_point: 'section' });
    if (d.isOnboardingPreview) { void d.unlockPreview(result); return; }
    void openRestaurantOrPaywall(d.locked === true, () => router.push({
      pathname: `/restaurant/${result.id}`,
      params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl, cuisine: result.cuisineTags?.[0] },
    }), d.onLockedTap);
  }
  const showRestaurants = cards.length > 0 && !d.loading && !d.refreshing && !d.location.loading && !d.error && !d.outOfArea;
  const emptyTitle = !d.canSearch ? 'Find your next meal' : d.hasQuery ? 'No matches for this search' : 'No meals with nutrition nearby';
  const more = d.nextCursor && !d.locked && !d.isOnboardingPreview && !d.loading && <Pressable style={s.more} disabled={d.loadingMore || d.refreshing}
    onPress={() => { void d.handleEndReached(); }} testID="map-load-more" accessibilityRole="button"
    accessibilityState={{ disabled: d.loadingMore || d.refreshing }}>
    <Text style={s.link}>{d.loadingMore ? 'Loading more…' : 'More spots'}</Text>
  </Pressable>;
  return <View style={s.root} testID="discovery-map" onLayout={event => setLayoutHeight(event.nativeEvent.layout.height)}>
    {!d.location.loading && <MapView ref={map} style={s.map} testID="discovery-map-surface"
      initialRegion={{ latitude: lat, longitude: lng, ...DELTA }} onMapReady={() => setMapRevision(value => value + 1)}
      onLayout={() => setMapRevision(value => value + 1)}
      onTouchStart={event => { panning.current = false; touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }; }}
      onTouchCancel={() => { touchStart.current = undefined; }}
      onPanDrag={() => { panning.current = true; }}
      onTouchEnd={event => {
        // MapKit scrolling can omit onPanDrag/onTouchMove while still delivering
        // touch endpoints before region completion. A tap must not arm a search.
        const start = touchStart.current;
        touchStart.current = undefined;
        if (start && Math.hypot(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y) > 8) {
          panning.current = true;
        }
      }}
      onRegionChangeComplete={region => {
        // MapKit also reports programmatic fits; only a real pan offers a search.
        if (!panning.current) return;
        panning.current = false;
        const { latitude, longitude } = region;
        if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)
          setPendingArea({ lat: latitude, lng: longitude });
      }}
      legalLabelInsets={{ top: 0, right: 0, bottom: trayHeight + bottomClearance + 8, left: 12 }}
      showsUserLocation={d.location.source === 'gps'} showsMyLocationButton={false}
      showsCompass={false} showsPointsOfInterest={false} scrollEnabled rotateEnabled={false}>
      {pins.map(result => <RestaurantMarker key={result.id} result={result} position={cards.indexOf(result)}
        pinStyle={pinStyle} selected={result.id === selectedId} onSelect={select} />)}
    </MapView>}
    {pendingArea && <View pointerEvents="none" style={s.areaCenter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ionicons name="add" size={28} color={EDITORIAL.green} />
    </View>}
    <View testID="map-controls" pointerEvents="box-none" style={[s.top, { top: insets.top + 8 }]}
      onLayout={event => { setTopHeight(event.nativeEvent.layout.height); onTourLayoutChange?.(); }}>
      {previewHeader && <View style={s.previewHeader}>{previewHeader}</View>}
      <View style={s.searchRow}>
        <Pressable ref={d.tourSearchRef} collapsable={false} style={s.searchEntry} testID="map-search-entry" onPress={onShowList}
          accessibilityRole="button" accessibilityLabel={d.query ? `Search: ${d.query}` : 'Search restaurants or dishes'}
          accessibilityHint="Open the list with search and macro editing">
          <FrostedSearchSurface />
          <Ionicons name="search" size={19} color={EDITORIAL.green} />
          <Text style={s.searchText} numberOfLines={1}>{d.query || 'Search restaurants or dishes'}</Text>
        </Pressable>
      </View>
      <View style={s.topRow} pointerEvents="box-none" testID="map-toolbar">
        <Pressable ref={d.tourLocationRef} collapsable={false} style={s.location} testID="discovery-location" onPress={d.handleOpenLocationPicker}
          accessibilityRole="button" accessibilityLabel={`Location: ${d.locationLabel}`} accessibilityHint="Change search area">
          <Ionicons name="location" size={15} color={EDITORIAL.green} />
          <Text style={s.locationText} numberOfLines={1}>{d.locationLabel}</Text>
          <Ionicons name="chevron-down" size={12} color={EDITORIAL.green} />
        </Pressable>
        <Pressable ref={d.tourEditRef} collapsable={false} style={s.goals} testID="map-goals" onPress={() => d.setFilterVisible(true)}
          accessibilityRole="button" accessibilityLabel="Edit macros">
          <Ionicons name="options-outline" size={16} color={EDITORIAL.green} /><Text style={s.locationText}>Macros</Text>
        </Pressable>
        {!d.isOnboardingPreview && <ShuffleButton style={s.shuffle} disabled={!d.canShuffle} onPress={d.handleShuffle} />}
        <Pressable style={s.optionsButton} testID="map-options-open" onPress={() => setOptionsVisible(true)}
          accessibilityRole="button" accessibilityLabel="Choose pin style">
          <Ionicons name="layers-outline" size={19} color={EDITORIAL.green} />
        </Pressable>
      </View>
      {pendingArea && <Pressable style={s.areaSearch} testID="map-search-area" accessibilityRole="button"
        accessibilityLabel="Search this area" accessibilityHint="Search near the center of the map with your current meal targets"
        onPress={() => d.handlePickLocation({ ...pendingArea, name: 'Map area' })}>
        <Ionicons name="search" size={17} color={EDITORIAL.green} /><Text style={s.locationText}>Search this area</Text>
      </Pressable>}
    </View>
    <View style={s.foreground} pointerEvents="box-none">
      <View style={s.spacer} pointerEvents="none" />
      <View testID="map-tray" style={[s.tray, { marginBottom: bottomClearance, maxHeight: maxTrayHeight }]}
        onLayout={event => { setTrayHeight(event.nativeEvent.layout.height); onTourLayoutChange?.(); }}>
        {fallback && <Text style={s.fallback} testID="map-location-fallback">
          {d.location.source === 'fallback-denied' ? 'Location off' : 'Location unavailable'} · Showing {d.locationLabel}. Change area above.
        </Text>}
        {!showRestaurants && <ScrollView style={{ flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={s.status} keyboardShouldPersistTaps="handled">
          {d.loading || d.refreshing || d.location.loading ? <View accessibilityLiveRegion="polite">
            <ActivityIndicator color={EDITORIAL.green} /><Text style={s.body}>Finding spots…</Text>
          </View> : d.error ? <>
            <Text style={s.body} accessibilityRole="alert">{d.error}</Text>
            <Pressable style={s.action} onPress={() => { void d.handleRefresh(); }} testID="preview-retry" accessibilityRole="button"><Text style={s.link}>Try again</Text></Pressable>
          </> : d.outOfArea ? <>
            <Text style={s.heading}>We're not in your area yet</Text>
            <Text style={s.body}>Fitsy is launching in Los Angeles first - your city is next on the list.</Text>
            <Pressable style={s.action} onPress={d.handleJoinWaitlist} testID="discovery-join-waitlist" accessibilityRole="button">
              <Text style={s.link}>Keep me posted</Text>
            </Pressable>
          </> : <>
            <Text style={s.heading}>{emptyTitle}</Text>
            <Text style={s.body}>Try another dish or area, or adjust your meal targets.</Text>
            <Pressable style={s.action} onPress={() => d.setFilterVisible(true)} testID="discovery-empty-edit" accessibilityRole="button"><Text style={s.link}>Adjust meal targets</Text></Pressable>
            {d.hasQuery && <Pressable style={s.action} onPress={d.handleClearQuery} testID="discovery-empty-clear" accessibilityRole="button"><Text style={s.link}>Clear search</Text></Pressable>}
          </>}
        </ScrollView>}
        {showRestaurants && <ScrollView ref={carousel} horizontal testID="map-carousel" style={{ height: compact ? 174 : 210, flexGrow: 0 }}
          showsHorizontalScrollIndicator={false} snapToInterval={stride} decelerationRate="fast" disableIntervalMomentum
          contentContainerStyle={s.carousel} keyboardShouldPersistTaps="handled"
          onLayout={() => { restoreCarousel(); onTourLayoutChange?.(); }} onContentSizeChange={restoreCarousel}
          onMomentumScrollEnd={event => {
            const result = cards[Math.min(cards.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / stride)))];
            if (result) select(result, false);
          }}>
          {cards.map((result, position) => <View key={result.id} ref={position === 0 ? d.tourHeroRef : undefined} collapsable={false} testID={result.id === selectedId ? 'map-preview' : undefined}>
            <DiscoveryMapCard result={result} locked={(d.locked === true && !d.isOnboardingPreview) || result.id === d.lockedTeaser?.id}
              onboardingPreview={d.isOnboardingPreview} hideDishName={d.isOnboardingPreview && position > 0}
              style={{ width: cardWidth, height: compact ? 174 : 210 }}
              testID={result.id === selectedId ? 'map-preview-open' : `map-card-${position}`} onPress={() => open(result)}
              label={`Open ${mapRestaurantLabel(result)}`} page={`${position + 1} / ${cards.length}`}
              pageTestID={position === Math.max(0, index) ? 'map-page' : undefined} />
          </View>)}
          {more && <View style={s.moreCard}>{more}</View>}
        </ScrollView>}
        {d.isOnboardingPreview && !d.loading && !d.refreshing && !d.error && !d.outOfArea &&
          <Pressable ref={d.tourMoreRef} collapsable={false} style={s.previewUnlock} testID="locked-value-cta"
            onPress={() => { void d.unlockPreview(); }} accessibilityRole="button"
            accessibilityLabel={cards.length ? 'Explore full menus. Explore full menus with Pro.' : 'Keep exploring. Try another dish or area. Explore Pro plans.'}>
            <Text style={s.link}>{cards.length ? 'Explore full menus with Pro →' : 'Explore Pro plans →'}</Text>
          </Pressable>}
      </View>
    </View>
    <Modal visible={optionsVisible} transparent animationType="fade" onRequestClose={() => setOptionsVisible(false)}>
      <View style={s.optionsBackdrop}>
        <Pressable style={s.optionsDismiss} onPress={() => setOptionsVisible(false)} accessibilityRole="button" accessibilityLabel="Close map options" />
        <ScrollView style={s.optionsPanel} contentContainerStyle={s.optionsContent} testID="map-options">
          <View style={s.optionsHeading}><Text style={s.heading}>Pin style</Text>
            <Pressable style={s.arrow} testID="map-options-close" onPress={() => setOptionsVisible(false)} accessibilityRole="button" accessibilityLabel="Done with map options">
              <Ionicons name="close" size={21} color={EDITORIAL.green} />
            </Pressable></View>
          <View style={s.pinOptions}>{PIN_STYLES.map(([key, symbol, label]) => <Pressable key={key}
            style={[s.pinOption, key === pinStyle && s.activeOption]} testID={`map-pin-style-${key}`}
            accessibilityRole="button" accessibilityLabel={`${label} pins`} accessibilityState={{ selected: key === pinStyle }}
            onPress={() => { router.setParams({ mapPin: key }); setOptionsVisible(false); }}>
            {key === 'icon' ? <Ionicons name="restaurant-outline" size={27} color={EDITORIAL.green} /> : <Text style={s.pinOptionSymbol}>{symbol}</Text>}<Text style={s.body}>{label}</Text>
          </Pressable>)}</View>
        </ScrollView>
      </View>
    </Modal>
  </View>;
}
