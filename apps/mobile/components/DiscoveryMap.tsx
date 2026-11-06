import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, PanResponder, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import type { RestaurantResult } from '@fitsy/shared';
import type { useDiscoveryState } from '@/lib/useDiscoveryState';
import { EDITORIAL } from '@/lib/brand';
import { hasMapCoordinate, mapRestaurantLabel } from '@/lib/discoveryMap';
import { trackRestaurantTapped } from '@/lib/analytics';
import { SearchBar } from './DiscoveryChrome';
import { HeroCard, RestaurantSection, openRestaurantOrPaywall } from './DiscoveryCards';
import { RestaurantPhoto } from './RestaurantPhoto';
import { DiscoveryViewToggle } from './DiscoveryViewToggle';
import { ShuffleButton } from './ShuffleButton';
import { s } from './DiscoveryMap.styles';
import { useFloatingNavClearance } from '@/lib/floatingNav';

type Discovery = ReturnType<typeof useDiscoveryState>;
const DELTA = { latitudeDelta: 0.09, longitudeDelta: 0.09 };
const VARIANTS = [['C', 'Carousel'], ['A', 'List'], ['B', 'Sheet']] as const;
const HEIGHTS = ['Peek', 'Half', 'Full'] as const;

// Snapshot only the short paint/selection transition, with no asynchronous photo in a pin.
const RestaurantMarker = React.memo(function RestaurantMarker({ result, position, selected, onSelect }: {
  result: RestaurantResult; position: number; selected: boolean; onSelect: (result: RestaurantResult) => void;
}) {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true);
    const timer = setTimeout(() => setTracking(false), 250);
    return () => clearTimeout(timer);
  }, [selected, position, result.name]);
  return <Marker identifier={result.id} coordinate={{ latitude: result.lat, longitude: result.lng }}
    anchor={{ x: 0.5, y: 0.28 }} stopPropagation tracksViewChanges={tracking}
    zIndex={selected ? 1000 : 100 - position} testID={`map-pin-${position}`}
    accessibilityRole="button" accessibilityLabel={mapRestaurantLabel(result)}
    accessibilityHint="Select restaurant card" accessibilityState={{ selected }} onPress={() => onSelect(result)}>
    <View style={s.pin} collapsable={false}>
      <View style={[s.pinBadge, selected && s.selectedPin]}>
        <Text style={[s.pinNumber, selected && s.selectedPinNumber]}>{String(position + 1).padStart(2, '0')}</Text>
      </View>
      {selected && <Text style={s.pinLabel} numberOfLines={1}>{result.name}</Text>}
    </View>
  </Marker>;
});

// Loaded only by DiscoveryScreen's existing development-iOS experiment gate.
export default function DiscoveryMap({ discovery: d, onShowList }: { discovery: Discovery; onShowList: () => void }) {
  const insets = useSafeAreaInsets();
  const tabBarClearance = useFloatingNavClearance();
  const { width, height } = useWindowDimensions();
  const { mapTray } = useLocalSearchParams<{ mapTray?: string }>();
  const variant = mapTray === 'A' || mapTray === 'B' ? mapTray : 'C';
  const map = useRef<MapView>(null);
  const carousel = useRef<ScrollView>(null);
  const list = useRef<ScrollView>(null);
  const rowOffsets = useRef<Record<string, number>>({});
  const [mapReady, setMapReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [trayHeight, setTrayHeight] = useState(220);
  const [topHeight, setTopHeight] = useState(156);
  const [layoutHeight, setLayoutHeight] = useState(height);
  const [detent, setDetent] = useState(1);
  const cardWidth = width - 56;
  const stride = cardWidth + 12;
  const compact = height < 740;
  const maxTrayHeight = Math.max(160, layoutHeight - insets.top - topHeight - tabBarClearance - 20);
  const sheetHeights = [Math.min(196, maxTrayHeight), Math.min(layoutHeight * 0.53, maxTrayHeight), maxTrayHeight];
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
  useEffect(() => {
    setSelectedId(undefined);
    if (!d.location.loading) map.current?.animateToRegion({ latitude: lat, longitude: lng, ...DELTA }, 350);
  }, [lat, lng, d.location.loading]);
  // A replacement search starts at its first card; pagination preserves selection.
  const firstId = cards[0]?.id;
  useEffect(() => {
    setSelectedId(undefined);
    carousel.current?.scrollTo({ x: 0, animated: false });
    list.current?.scrollTo({ y: 0, animated: false });
  }, [firstId]);
  useEffect(() => {
    const top = insets.top + topHeight + 24, bottom = trayHeight + tabBarClearance + 24;
    // Frame only the loaded results, and never fetch when the camera moves.
    if (mapReady && pins.length > 1 && layoutHeight - top - bottom > 100) {
      map.current?.fitToCoordinates(pins.map(result => ({ latitude: result.lat, longitude: result.lng })),
        { edgePadding: { top, bottom, left: 40, right: 40 }, animated: true });
    }
  }, [mapReady, pins, insets.top, topHeight, trayHeight, tabBarClearance, layoutHeight]);
  function select(result: RestaurantResult, scroll = true) {
    setSelectedId(result.id);
    if (hasMapCoordinate(result)) map.current?.animateCamera({ center: { latitude: result.lat, longitude: result.lng } }, { duration: 300 });
    if (scroll) {
      carousel.current?.scrollTo({ x: cards.findIndex(card => card.id === result.id) * stride, animated: true });
      list.current?.scrollTo({ y: rowOffsets.current[result.id] ?? 0, animated: true });
    }
  }
  function open(result: RestaurantResult) {
    trackRestaurantTapped({ restaurant_id: result.id, restaurant_name: result.name,
      position: cards.findIndex(card => card.id === result.id), entry_point: 'section' });
    void openRestaurantOrPaywall(d.locked === true, () => router.push({
      pathname: `/restaurant/${result.id}`,
      params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl, cuisine: result.cuisineTags?.[0] },
    }), d.onLockedTap);
  }
  const emptyTitle = !d.canSearch ? 'Find your next meal' : d.hasQuery ? 'No matches for this search' : 'No meals with nutrition nearby';
  const more = d.nextCursor && !d.locked && !d.loading && <Pressable style={s.more} disabled={d.loadingMore || d.refreshing}
    onPress={() => { void d.handleEndReached(); }} testID="map-load-more" accessibilityRole="button"
    accessibilityState={{ disabled: d.loadingMore || d.refreshing }}>
    <Text style={s.link}>{d.loadingMore ? 'Loading more…' : 'More spots'}</Text>
  </Pressable>;
  return <View style={s.root} testID="discovery-map" onLayout={event => setLayoutHeight(event.nativeEvent.layout.height)}>
    {!d.location.loading && <MapView ref={map} style={s.map} testID="discovery-map-surface"
      initialRegion={{ latitude: lat, longitude: lng, ...DELTA }}
      onMapReady={() => { map.current?.animateToRegion({ latitude: lat, longitude: lng, ...DELTA }, 0); setMapReady(true); }}
      mapPadding={{ top: insets.top + topHeight + 12, right: 24, bottom: trayHeight + tabBarClearance + 12, left: 24 }}
      showsUserLocation={d.location.source === 'gps'} showsMyLocationButton={false}
      showsCompass={false} showsPointsOfInterest={false} rotateEnabled={false}
      onPress={() => setSelectedId(undefined)}>
      {pins.map(result => <RestaurantMarker key={result.id} result={result} position={cards.indexOf(result)}
        selected={result.id === selectedId} onSelect={select} />)}
    </MapView>}
    <View pointerEvents="box-none" style={[s.top, { top: insets.top + 8 }]}
      onLayout={event => setTopHeight(event.nativeEvent.layout.height)}>
      <SearchBar value={d.query} onChangeText={d.setQuery} onClear={d.handleClearQuery}
        action={<ShuffleButton disabled={!d.canShuffle} onPress={d.handleShuffle} />} />
      <View style={s.topRow} pointerEvents="box-none">
        <Pressable style={s.location} testID="discovery-location" onPress={d.handleOpenLocationPicker}
          accessibilityRole="button" accessibilityLabel={`Location: ${d.locationLabel}`} accessibilityHint="Change search area">
          <Ionicons name="location" size={16} color={EDITORIAL.green} />
          <Text style={s.locationText} numberOfLines={1}>{d.locationLabel}</Text>
          <Ionicons name="chevron-down" size={12} color={EDITORIAL.green} />
        </Pressable>
        <DiscoveryViewToggle map onPress={onShowList} />
      </View>
      <ScrollView horizontal style={s.chipsViewport} showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
        {(['calories', 'protein', 'carbs', 'fat'] as const).map((key, position) => <Pressable key={key}
          style={s.chip} onPress={() => d.setFilterVisible(true)} testID={position === 0 ? 'preview-edit-targets' : `map-filter-${key}`}
          accessibilityRole="button" accessibilityLabel={`Edit ${key === 'calories' ? 'calories per meal' : `${key} grams`}, ${d.inputs[key] || 'not set'}`}>
          <Text style={s.chipText}>{d.inputs[key] || 'Any'}{d.inputs[key] && key !== 'calories' ? 'g' : ''} {key === 'calories' ? 'kcal' : key}</Text>
        </Pressable>)}
      </ScrollView>
    </View>
    <KeyboardAvoidingView style={s.foreground} behavior="padding" pointerEvents="box-none">
      <View style={s.spacer} pointerEvents="none" />
      <View testID="map-tray" style={[s.tray, variant !== 'C' && s.solidTray, { marginBottom: tabBarClearance },
        variant === 'A' && { height: Math.min(layoutHeight * 0.56, maxTrayHeight) }, variant === 'B' && { height: sheetHeights[detent] }]}
        onLayout={event => setTrayHeight(event.nativeEvent.layout.height)}>
        {variant === 'B' && <View testID={`map-sheet-${HEIGHTS[detent].toLowerCase()}`} {...pan.panHandlers}>
          <Pressable testID="map-sheet-height" style={s.grabberButton} onPress={() => setDetent(current => (current + 1) % 3)}
            accessibilityRole="adjustable" accessibilityLabel="Restaurant sheet height" accessibilityValue={{ text: HEIGHTS[detent] }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={event => setDetent(current => Math.max(0, Math.min(2, current + (event.nativeEvent.actionName === 'increment' ? 1 : -1))))}>
            <View style={s.grabber} /><Text style={s.heightLabel}>{HEIGHTS[detent]} · tap or drag</Text>
          </Pressable>
        </View>}
        <View style={s.caption}>
          <Text style={s.heading}>Nearby</Text>
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
        </View>
        {fallback && <Text style={s.fallback} testID="map-location-fallback">
          {d.location.source === 'fallback-denied' ? 'Location off' : 'Location unavailable'} · Showing {d.locationLabel}. Change area above.
        </Text>}
        {(d.loading || d.refreshing || d.location.loading) && <View style={s.status} accessibilityLiveRegion="polite">
          <ActivityIndicator color={EDITORIAL.green} /><Text style={s.body}>Finding spots…</Text>
        </View>}
        {!d.loading && d.error && <View style={s.status}>
          <Text style={s.body} accessibilityRole="alert">{d.error}</Text>
          <Pressable style={s.action} onPress={() => { void d.handleRefresh(); }} testID="preview-retry" accessibilityRole="button"><Text style={s.link}>Try again</Text></Pressable>
        </View>}
        {!d.loading && !d.error && cards.length === 0 && <View style={s.status}>
          <Text style={s.heading}>{emptyTitle}</Text>
          <Text style={s.body}>Try another dish or area, or adjust your meal targets.</Text>
          <Pressable style={s.action} onPress={() => d.setFilterVisible(true)} testID="discovery-empty-edit" accessibilityRole="button"><Text style={s.link}>Adjust meal targets</Text></Pressable>
          {d.hasQuery && <Pressable style={s.action} onPress={d.handleClearQuery} testID="discovery-empty-clear" accessibilityRole="button"><Text style={s.link}>Clear search</Text></Pressable>}
        </View>}
        {cards.length > 0 && variant === 'C' && <ScrollView ref={carousel} horizontal testID="map-carousel" style={{ height: compact ? 166 : 206, flexGrow: 0 }}
          showsHorizontalScrollIndicator={false} snapToInterval={stride} decelerationRate="fast" disableIntervalMomentum
          contentContainerStyle={s.carousel} keyboardShouldPersistTaps="handled"
          onMomentumScrollEnd={event => {
            const result = cards[Math.min(cards.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / stride)))];
            if (result) select(result, false);
          }}>
          {cards.map((result, position) => <View key={result.id} testID={result.id === selectedId ? 'map-preview' : undefined}>
            <Pressable style={[s.card, { width: cardWidth }, result.id === selectedId && s.selectedCard]}
              testID={result.id === selectedId ? 'map-preview-open' : `map-card-${position}`} onPress={() => open(result)}
              accessibilityRole="button" accessibilityLabel={`Open ${mapRestaurantLabel(result)}`}>
              <RestaurantPhoto uri={result.photoUrl} name={result.name} style={[s.cardPhoto, compact && s.compactPhoto]} thumbnail />
              <View style={s.cardCopy}>
                <View style={s.cardTitleRow}><Text style={s.cardNumber}>{String(position + 1).padStart(2, '0')}</Text>
                  <Text style={s.cardTitle} numberOfLines={1}>{result.name}</Text></View>
                <Text style={s.body} numberOfLines={1}>{result.cuisineTags.join(', ') || 'Restaurant'}{Number.isFinite(result.distanceMiles) ? ` · ${result.distanceMiles.toFixed(1)} mi` : ''}</Text>
                <Text style={s.previewLink}>View menu →</Text>
              </View>
            </Pressable>
          </View>)}
          {more && <View style={s.moreCard}>{more}</View>}
        </ScrollView>}
        {cards.length > 0 && variant !== 'C' && <ScrollView ref={list} style={s.list} testID={`map-list-${variant}`}
          contentContainerStyle={s.listContent} keyboardShouldPersistTaps="handled"
          onMomentumScrollEnd={event => {
            const y = event.nativeEvent.contentOffset.y;
            const result = [...cards].reverse().find(card => (rowOffsets.current[card.id] ?? Infinity) <= y + 40);
            if (result) select(result, false);
          }}>
          {cards.map((result, position) => <View key={result.id} style={result.id === selectedId && s.selectedRow}
            onLayout={event => { rowOffsets.current[result.id] = event.nativeEvent.layout.y; }}>
            {position === 0 ? <HeroCard result={result} locked={d.locked === true} unlocking={d.onLockedTap} />
              : <RestaurantSection result={result} index={position - 1} locked={d.locked === true} unlocking={d.onLockedTap} />}
          </View>)}
          {more}
        </ScrollView>}
        <View style={s.variants} accessibilityLabel="Map layout prototypes">
          {VARIANTS.map(([key, label]) => <Pressable key={key} style={[s.variant, key === variant && s.activeVariant]}
            testID={`map-variant-${key}`} accessibilityRole="button" accessibilityLabel={`Prototype ${key}: ${label}`}
            accessibilityState={{ selected: key === variant }} onPress={() => { setSelectedId(undefined); router.setParams({ mapTray: key }); }}>
            <Text style={[s.variantText, key === variant && s.activeVariantText]}>{key} · {label}</Text>
          </Pressable>)}
        </View>
      </View>
    </KeyboardAvoidingView>
  </View>;
}
