import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, PanResponder, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import type { RestaurantResult } from '@fitsy/shared';
import type { useDiscoveryState } from '@/lib/useDiscoveryState';
import { EDITORIAL } from '@/lib/brand';
import { hasMapCoordinate, mapCuisineEmoji, mapRestaurantLabel } from '@/lib/discoveryMap';
import { trackRestaurantTapped } from '@/lib/analytics';
import { FrostedSearchSurface, MacroStrip } from './DiscoveryChrome';
import { openRestaurantOrPaywall } from './DiscoveryCards';
import { DiscoveryMapCard } from './DiscoveryMapCard';
import { ShuffleButton } from './ShuffleButton';
import { s } from './DiscoveryMap.styles';
import { useFloatingNavClearance } from '@/lib/floatingNav';

type Discovery = ReturnType<typeof useDiscoveryState>;
type PinStyle = 'numbered' | 'utensils' | 'cuisine' | 'icon';
const DELTA = { latitudeDelta: 0.09, longitudeDelta: 0.09 };
const VARIANTS = [['G', 'C alternate · Macros'], ['C', 'Search to list'], ['A', 'Map + list'], ['B', 'Slim sheet']] as const;
const PIN_STYLES = [['numbered', '01', 'Numbers'], ['utensils', '🍴', 'Utensils'], ['cuisine', '🌮', 'Cuisine'], ['icon', '', 'Icon']] as const;
const HEIGHTS = ['Peek', 'Half', 'Full'] as const;

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

// Loaded only by DiscoveryScreen's existing development-iOS experiment gate.
export default function DiscoveryMap({ discovery: d, onShowList }: { discovery: Discovery; onShowList: () => void }) {
  const insets = useSafeAreaInsets();
  const tabBarClearance = useFloatingNavClearance();
  const { width, height } = useWindowDimensions();
  const { mapTray, mapPin } = useLocalSearchParams<{ mapTray?: string; mapPin?: string }>();
  const variant = mapTray === 'A' || mapTray === 'B' || mapTray === 'C' ? mapTray : 'G';
  const pinStyle: PinStyle = mapPin === 'numbered' || mapPin === 'cuisine' || mapPin === 'icon' ? mapPin : 'utensils';
  const carouselLayout = variant === 'C' || variant === 'G';
  const map = useRef<MapView>(null);
  const carousel = useRef<ScrollView>(null);
  const list = useRef<ScrollView>(null);
  const rowOffsets = useRef<Record<string, number>>({});
  const listOffset = useRef(0);
  const userListScroll = useRef(false);
  const restoredLayout = useRef('');
  const [mapRevision, setMapRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [trayHeight, setTrayHeight] = useState(220);
  const [topHeight, setTopHeight] = useState(104);
  const [layoutHeight, setLayoutHeight] = useState(height);
  const [detent, setDetent] = useState(0);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const panning = useRef(false);
  const touchStart = useRef<{ x: number; y: number }>();
  const [pendingArea, setPendingArea] = useState<{ lat: number; lng: number } | null>(null);
  const cardWidth = width - 56;
  const stride = cardWidth + 12;
  const compact = height < 740;
  const controlsBottom = insets.top + 8 + topHeight;
  const maxTrayHeight = Math.max(160, layoutHeight - controlsBottom - tabBarClearance - 96);
  const sheetHeights = [Math.min(180, maxTrayHeight), Math.min(layoutHeight * 0.40, maxTrayHeight), maxTrayHeight];
  const peek = variant === 'B' && detent === 0;
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 8,
    onPanResponderRelease: (_event, gesture) => {
      if (Math.abs(gesture.dy) > 28) setDetent(current => Math.max(0, Math.min(2, current + (gesture.dy < 0 ? 1 : -1))));
    },
  }), []);
  // Match the list's free-result boundary and preserve rows without coordinates.
  const cards = useMemo(() => d.canSearch && !d.loading ? (d.locked ? d.results.slice(0, 3) : d.results) : [],
    [d.canSearch, d.loading, d.locked, d.results]);
  const pins = useMemo(() => cards.filter(hasMapCoordinate), [cards]);
  const index = cards.findIndex(result => result.id === selectedId);
  const fallback = !d.location.loading && d.location.source.startsWith('fallback-');
  const { lat, lng } = d.location;
  useEffect(() => { setPendingArea(null); panning.current = false; }, [lat, lng]);
  const firstId = cards[0]?.id;
  useEffect(() => {
    setSelectedId(undefined);
    userListScroll.current = false;
    listOffset.current = 0;
    carousel.current?.scrollTo({ x: 0, animated: false });
    list.current?.scrollTo({ y: 0, animated: false });
  }, [firstId, lat, lng]);
  useEffect(() => {
    if (!mapRevision || d.location.loading || panning.current || pendingArea) return;
    // One camera writer, after measured layout. Do not also set mapPadding:
    // Apple Maps applies those layout margins in addition to this fitted inset.
    const frame = requestAnimationFrame(() => {
      if (!pins.length) {
        map.current?.animateToRegion({ latitude: lat, longitude: lng, ...DELTA }, 0);
        return;
      }
      const coordinates = pins.length === 1
        ? [{ latitude: pins[0].lat - 0.004, longitude: pins[0].lng - 0.004 },
          { latitude: pins[0].lat + 0.004, longitude: pins[0].lng + 0.004 }]
        : pins.map(result => ({ latitude: result.lat, longitude: result.lng }));
      map.current?.fitToCoordinates(coordinates, { edgePadding: {
        top: controlsBottom + 28, bottom: trayHeight + tabBarClearance + 28, left: 32, right: 32,
      }, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [mapRevision, pins, controlsBottom, trayHeight, tabBarClearance, layoutHeight, lat, lng, d.location.loading, pendingArea]);
  const restoreList = useCallback(() => {
    if (peek || userListScroll.current) return;
    list.current?.scrollTo({ y: selectedId ? rowOffsets.current[selectedId] ?? listOffset.current : listOffset.current, animated: false });
  }, [peek, selectedId]);
  const restoreCarousel = useCallback(() => {
    // Refresh/error states unmount this view while retaining the selected row.
    carousel.current?.scrollTo({ x: Math.max(0, index) * stride, animated: false });
  }, [index, stride]);
  useEffect(() => {
    const layout = `${variant}:${detent}`;
    if (restoredLayout.current === layout) return;
    restoredLayout.current = layout;
    userListScroll.current = false;
    if (peek || carouselLayout) return;
    const frame = requestAnimationFrame(restoreList);
    return () => cancelAnimationFrame(frame);
  }, [detent, variant, peek, carouselLayout, restoreList]);
  function select(result: RestaurantResult, scroll = true) {
    setSelectedId(result.id);
    if (scroll) {
      userListScroll.current = false;
      carousel.current?.scrollTo({ x: cards.findIndex(card => card.id === result.id) * stride, animated: true });
      list.current?.scrollTo({ y: rowOffsets.current[result.id] ?? 0, animated: true });
    }
  }
  function selectVisibleCard(y: number) {
    // A clamped programmatic scroll must retain its explicit final-row target.
    if (!userListScroll.current) return;
    const result = [...cards].reverse().find(card => (rowOffsets.current[card.id] ?? Infinity) <= y + 40);
    if (result) select(result, false);
  }
  function open(result: RestaurantResult) {
    trackRestaurantTapped({ restaurant_id: result.id, restaurant_name: result.name,
      position: cards.findIndex(card => card.id === result.id), entry_point: 'section' });
    void openRestaurantOrPaywall(d.locked === true, () => router.push({
      pathname: `/restaurant/${result.id}`,
      params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl, cuisine: result.cuisineTags?.[0] },
    }), d.onLockedTap);
  }
  const preview = cards[Math.max(0, index)];
  const showRestaurants = cards.length > 0 && !d.loading && !d.refreshing && !d.location.loading && !d.error;
  const emptyTitle = !d.canSearch ? 'Find your next meal' : d.hasQuery ? 'No matches for this search' : 'No meals with nutrition nearby';
  const more = d.nextCursor && !d.locked && !d.loading && <Pressable style={s.more} disabled={d.loadingMore || d.refreshing}
    onPress={() => { void d.handleEndReached(); }} testID="map-load-more" accessibilityRole="button"
    accessibilityState={{ disabled: d.loadingMore || d.refreshing }}>
    <Text style={s.link}>{d.loadingMore ? 'Loading more…' : 'More spots'}</Text>
  </Pressable>;
  return <View style={s.root} testID="discovery-map" onLayout={event => setLayoutHeight(event.nativeEvent.layout.height)}>
    {!d.location.loading && <MapView ref={map} style={s.map} testID="discovery-map-surface"
      initialRegion={{ latitude: lat, longitude: lng, ...DELTA }} onMapReady={() => setMapRevision(value => value + 1)}
      onLayout={() => setMapRevision(value => value + 1)}
      onTouchStart={event => { touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }; if (__DEV__) console.info('issue755-map-gesture', 'touchStart'); }}
      onTouchMove={() => { if (__DEV__) console.info('issue755-map-gesture', 'touchMove'); }}
      onTouchEnd={event => { if (__DEV__) console.info('issue755-map-gesture', 'touchEndMoved', Boolean(touchStart.current && Math.hypot(event.nativeEvent.pageX - touchStart.current.x, event.nativeEvent.pageY - touchStart.current.y) > 8)); }}
      onTouchCancel={() => { if (__DEV__) console.info('issue755-map-gesture', 'touchCancel'); }}
      onPanDrag={() => { if (__DEV__) console.info('issue755-map-gesture', 'pan'); panning.current = true; setPendingArea(null); }}
      onRegionChangeComplete={region => {
        if (__DEV__) console.info('issue755-map-gesture', 'regionComplete', panning.current);
        // MapKit also reports programmatic fits; only a real pan offers a search.
        if (!panning.current) return;
        panning.current = false;
        const { latitude, longitude } = region;
        if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)
          setPendingArea({ lat: latitude, lng: longitude });
      }}
      legalLabelInsets={{ top: 0, right: 0, bottom: trayHeight + tabBarClearance + 8, left: 12 }}
      showsUserLocation={d.location.source === 'gps'} showsMyLocationButton={false}
      showsCompass={false} showsPointsOfInterest={false} rotateEnabled={false}>
      {pins.map(result => <RestaurantMarker key={result.id} result={result} position={cards.indexOf(result)}
        pinStyle={pinStyle} selected={result.id === selectedId} onSelect={select} />)}
    </MapView>}
    {pendingArea && <View pointerEvents="none" style={s.areaCenter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ionicons name="add" size={28} color={EDITORIAL.green} />
    </View>}
    <View testID="map-controls" pointerEvents="box-none" style={[s.top, { top: insets.top + 8 }]}
      onLayout={event => setTopHeight(event.nativeEvent.layout.height)}>
      <View style={s.searchRow}>
        <Pressable style={s.searchEntry} testID="map-search-entry" onPress={onShowList}
          accessibilityRole="button" accessibilityLabel={d.query ? `Search: ${d.query}` : 'Search restaurants or dishes'}
          accessibilityHint="Open the list with search and macro editing">
          <FrostedSearchSurface />
          <Ionicons name="search" size={19} color={EDITORIAL.green} />
          <Text style={s.searchText} numberOfLines={1}>{d.query || 'Search restaurants or dishes'}</Text>
        </Pressable>
        <ShuffleButton style={s.shuffle} disabled={!d.canShuffle} onPress={d.handleShuffle} />
      </View>
      <View style={s.topRow} pointerEvents="box-none">
        <Pressable style={s.location} testID="discovery-location" onPress={d.handleOpenLocationPicker}
          accessibilityRole="button" accessibilityLabel={`Location: ${d.locationLabel}`} accessibilityHint="Change search area">
          <Ionicons name="location" size={15} color={EDITORIAL.green} />
          <Text style={s.locationText} numberOfLines={1}>{d.locationLabel}</Text>
          <Ionicons name="chevron-down" size={12} color={EDITORIAL.green} />
        </Pressable>
        {variant === 'G' && <Pressable style={s.goals} testID="map-goals" onPress={() => d.setFilterVisible(true)}
          accessibilityRole="button" accessibilityLabel="Edit macros">
          <Ionicons name="options-outline" size={16} color={EDITORIAL.green} /><Text style={s.locationText}>Macros</Text>
        </Pressable>}
        <Pressable style={s.optionsButton} testID="map-options-open" onPress={() => setOptionsVisible(true)}
          accessibilityRole="button" accessibilityLabel="Map prototype options">
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
      <View testID="map-tray" style={[s.tray, !carouselLayout && s.solidTray, { marginBottom: tabBarClearance, maxHeight: maxTrayHeight },
        showRestaurants && variant === 'A' && { height: Math.min(layoutHeight * 0.42, maxTrayHeight) },
        showRestaurants && variant === 'B' && (!peek || !fallback) && { height: sheetHeights[detent] }]}
        onLayout={event => setTrayHeight(event.nativeEvent.layout.height)}>
        {variant === 'B' && <View testID={`map-sheet-${HEIGHTS[detent].toLowerCase()}`} {...pan.panHandlers}>
          <Pressable testID="map-sheet-height" style={s.grabberButton} onPress={() => setDetent(current => (current + 1) % 3)}
            accessibilityRole="adjustable" accessibilityLabel="Restaurant sheet height" accessibilityValue={{ text: HEIGHTS[detent] }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={event => setDetent(current => Math.max(0, Math.min(2, current + (event.nativeEvent.actionName === 'increment' ? 1 : -1))))}>
            <View style={s.grabber} /><Text style={s.heightLabel}>{!showRestaurants ? 'Search results' : peek ? `${cards.length} places · pull up to explore` : `${HEIGHTS[detent]} · tap or drag`}</Text>
          </Pressable>
        </View>}
        {showRestaurants && !carouselLayout && !peek && <View style={s.caption}>
          <Text style={s.heading}>Your picks</Text>
          <Text style={s.count} testID="map-page">{index < 0 ? `${cards.length} spots` : `${index + 1} / ${cards.length}`}</Text>
          {index >= 0 && <Pressable onPress={() => setSelectedId(undefined)} style={s.arrow} testID="map-preview-close"
            accessibilityRole="button" accessibilityLabel="Clear restaurant selection"><Ionicons name="close" size={16} color={EDITORIAL.green} /></Pressable>}
          <Pressable testID="map-previous-spot" style={s.arrow} disabled={index <= 0} onPress={() => select(cards[index - 1])}
            accessibilityRole="button" accessibilityLabel="Previous spot" accessibilityState={{ disabled: index <= 0 }}>
            <Ionicons name="chevron-back" size={19} color={index <= 0 ? EDITORIAL.textSoft : EDITORIAL.green} />
          </Pressable>
          <Pressable testID="map-next-spot" style={s.arrow} disabled={!cards.length || index === cards.length - 1}
            onPress={() => select(cards[index + 1])} accessibilityRole="button" accessibilityLabel="Next spot"
            accessibilityState={{ disabled: !cards.length || index === cards.length - 1 }}>
            <Ionicons name="chevron-forward" size={19} color={!cards.length || index === cards.length - 1 ? EDITORIAL.textSoft : EDITORIAL.green} />
          </Pressable>
        </View>}
        {showRestaurants && variant === 'B' && detent === 2 && <MacroStrip macros={d.inputs} onEdit={() => d.setFilterVisible(true)} />}
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
          </> : <>
            <Text style={s.heading}>{emptyTitle}</Text>
            <Text style={s.body}>Try another dish or area, or adjust your meal targets.</Text>
            <Pressable style={s.action} onPress={() => d.setFilterVisible(true)} testID="discovery-empty-edit" accessibilityRole="button"><Text style={s.link}>Adjust meal targets</Text></Pressable>
            {d.hasQuery && <Pressable style={s.action} onPress={d.handleClearQuery} testID="discovery-empty-clear" accessibilityRole="button"><Text style={s.link}>Clear search</Text></Pressable>}
          </>}
        </ScrollView>}
        {showRestaurants && carouselLayout && <ScrollView ref={carousel} horizontal testID="map-carousel" style={{ height: compact ? 174 : 210, flexGrow: 0 }}
          showsHorizontalScrollIndicator={false} snapToInterval={stride} decelerationRate="fast" disableIntervalMomentum
          contentContainerStyle={s.carousel} keyboardShouldPersistTaps="handled"
          onLayout={restoreCarousel} onContentSizeChange={restoreCarousel}
          onMomentumScrollEnd={event => {
            const result = cards[Math.min(cards.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / stride)))];
            if (result) select(result, false);
          }}>
          {cards.map((result, position) => <View key={result.id} testID={result.id === selectedId ? 'map-preview' : undefined}>
            <DiscoveryMapCard result={result} locked={d.locked === true} style={{ width: cardWidth, height: compact ? 174 : 210 }}
              testID={result.id === selectedId ? 'map-preview-open' : `map-card-${position}`} onPress={() => open(result)}
              label={`Open ${mapRestaurantLabel(result)}`} page={`${position + 1} / ${cards.length}`}
              pageTestID={position === Math.max(0, index) ? 'map-page' : undefined} />
          </View>)}
          {more && <View style={s.moreCard}>{more}</View>}
        </ScrollView>}
        {showRestaurants && peek && preview && <DiscoveryMapCard result={preview} locked={d.locked === true} peek style={s.peekCard}
          testID="map-sheet-peek-card" onPress={() => open(preview)} label={`Open ${mapRestaurantLabel(preview)}`} />}
        {showRestaurants && !carouselLayout && <ScrollView ref={list} style={[s.list, peek && s.hiddenList]} testID={`map-list-${variant}`}
          accessibilityElementsHidden={peek} importantForAccessibility={peek ? 'no-hide-descendants' : 'auto'} pointerEvents={peek ? 'none' : 'auto'}
          contentContainerStyle={s.listContent} keyboardShouldPersistTaps="handled"
          onLayout={restoreList} onContentSizeChange={restoreList}
          onScroll={event => { if (!peek) listOffset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}
          onScrollBeginDrag={() => { userListScroll.current = true; }}
          onScrollEndDrag={event => selectVisibleCard(event.nativeEvent.contentOffset.y)}
          onMomentumScrollEnd={event => selectVisibleCard(event.nativeEvent.contentOffset.y)}>
          {cards.map((result, position) => <View key={result.id} style={result.id === selectedId && s.selectedRow}
            onLayout={event => { rowOffsets.current[result.id] = event.nativeEvent.layout.y; }}>
            <View testID={position === 0 && variant === 'A' ? 'preview-pick-1' : undefined}>
              <DiscoveryMapCard result={result} locked={d.locked === true} style={s.listCard} onPress={() => open(result)}
                testID={position === 0 && variant === 'A' ? 'discovery-hero' : `preview-pick-${position + 1}`}
                label={`${result.name}, view full menu`} />
            </View>
          </View>)}
          {more}
        </ScrollView>}
      </View>
    </View>
    <Modal visible={optionsVisible} transparent animationType="fade" onRequestClose={() => setOptionsVisible(false)}>
      <View style={s.optionsBackdrop}>
        <Pressable style={s.optionsDismiss} onPress={() => setOptionsVisible(false)} accessibilityRole="button" accessibilityLabel="Close map options" />
        <ScrollView style={s.optionsPanel} contentContainerStyle={s.optionsContent} testID="map-options">
          <View style={s.optionsHeading}><Text style={s.heading}>Map studies</Text>
            <Pressable style={s.arrow} testID="map-options-close" onPress={() => setOptionsVisible(false)} accessibilityRole="button" accessibilityLabel="Done with map options">
              <Ionicons name="close" size={21} color={EDITORIAL.green} />
            </Pressable></View>
          <Text style={s.optionLabel}>LAYOUT</Text>
          <View style={s.optionGrid}>{VARIANTS.map(([key, label]) => <Pressable key={key} style={[s.option, s.gridOption, key === variant && s.activeOption]}
            testID={`map-variant-${key}`} accessibilityRole="button" accessibilityLabel={`Prototype ${key}: ${label}`}
            accessibilityState={{ selected: key === variant }} onPress={() => { userListScroll.current = false; setSelectedId(undefined); listOffset.current = 0; router.setParams({ mapTray: key }); setOptionsVisible(false); }}>
            <Text style={s.optionText}>{label}</Text>{key === variant && <Ionicons name="checkmark" size={20} color={EDITORIAL.green} />}
          </Pressable>)}</View>
          <Text style={s.optionLabel}>PINS</Text>
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
