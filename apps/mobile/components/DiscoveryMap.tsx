import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { RestaurantResult } from '@fitsy/shared';
import type { useDiscoveryState } from '@/lib/useDiscoveryState';
import { EDITORIAL } from '@/lib/brand';
import { hasMapCoordinate, mapRestaurantLabel } from '@/lib/discoveryMap';
import { trackRestaurantTapped } from '@/lib/analytics';
import { SearchBar } from './DiscoveryChrome';
import { openRestaurantOrPaywall } from './DiscoveryCards';
import { RestaurantPhoto } from './RestaurantPhoto';
import { DiscoveryViewToggle } from './DiscoveryViewToggle';
import { ShuffleButton } from './ShuffleButton';
import { s } from './DiscoveryMap.styles';
import { useFloatingNavClearance } from '@/lib/floatingNav';

type Discovery = ReturnType<typeof useDiscoveryState>;
const DELTA = { latitudeDelta: 0.09, longitudeDelta: 0.09 };

export default function DiscoveryMap({ discovery: d, onShowList }: { discovery: Discovery; onShowList: () => void }) {
  const insets = useSafeAreaInsets();
  const tabBarClearance = useFloatingNavClearance();
  const map = useRef<MapView>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [trayHeight, setTrayHeight] = useState(220);
  // Apply the same free-result boundary as the list; the map grants no extra access.
  const visibleResults = d.locked ? d.results.slice(0, 3) : d.results;
  const pins = d.canSearch && !d.loading ? visibleResults.filter(hasMapCoordinate) : [];
  const selected = pins.find(result => result.id === selectedId);
  const index = selected ? pins.indexOf(selected) : -1;
  const fallback = !d.location.loading && d.location.source.startsWith('fallback-');
  const { lat, lng } = d.location;
  useEffect(() => {
    setSelectedId(undefined);
    if (!d.location.loading) map.current?.animateToRegion({ latitude: lat, longitude: lng, ...DELTA }, 350);
  }, [lat, lng, d.location.loading]);
  function select(result: RestaurantResult) {
    setSelectedId(result.id);
    map.current?.animateToRegion({ latitude: result.lat, longitude: result.lng, ...DELTA }, 300);
  }
  function open(result: RestaurantResult) {
    trackRestaurantTapped({ restaurant_id: result.id, restaurant_name: result.name, position: index, entry_point: 'section' });
    void openRestaurantOrPaywall(d.locked === true, () => router.push({
      pathname: `/restaurant/${result.id}`,
      params: { address: result.address, distance: result.distanceMiles?.toFixed(1), photoUrl: result.photoUrl, cuisine: result.cuisineTags?.[0] },
    }), d.onLockedTap);
  }
  const emptyTitle = !d.canSearch ? 'Find your next meal' : d.hasQuery ? 'No matches for this search' : 'No meals with nutrition nearby';
  return <View style={s.root} testID="discovery-map">
    {!d.location.loading && <MapView ref={map} style={s.map} testID="discovery-map-surface"
      initialRegion={{ latitude: lat, longitude: lng, ...DELTA }}
      onMapReady={() => map.current?.animateToRegion({ latitude: lat, longitude: lng, ...DELTA }, 0)}
      mapPadding={{ top: insets.top + 72, right: 24, bottom: trayHeight + tabBarClearance + 12, left: 24 }}
      showsUserLocation={d.location.source === 'gps'} showsMyLocationButton={false}
      showsCompass={false} showsPointsOfInterest={false} rotateEnabled={false}
      onPress={() => setSelectedId(undefined)}>
      {pins.map((result, position) => <Marker key={result.id} identifier={result.id}
        coordinate={{ latitude: result.lat, longitude: result.lng }} anchor={{ x: 0.5, y: 0.5 }} stopPropagation
        zIndex={result.id === selectedId ? 1000 : pins.length - position}
        testID={`map-pin-${position}`} accessibilityRole="button" accessibilityLabel={mapRestaurantLabel(result)}
        accessibilityHint="Show restaurant preview" accessibilityState={{ selected: result.id === selectedId }}
        onPress={() => select(result)}>
        <View style={s.pin} collapsable={false}>
          <View style={[s.photoRing, result.id === selectedId && s.selectedRing]}>
            <RestaurantPhoto uri={result.photoUrl} name={result.name} style={s.pinPhoto} thumbnail />
          </View>
          <Text style={s.pinLabel} numberOfLines={1}>{mapRestaurantLabel(result)}</Text>
        </View>
      </Marker>)}
    </MapView>}
    <View pointerEvents="box-none" style={[s.top, { top: insets.top + 12 }]}>
      <Pressable style={s.location} testID="discovery-location" onPress={d.handleOpenLocationPicker}
        accessibilityRole="button" accessibilityLabel={`Location: ${d.locationLabel}`} accessibilityHint="Change search area">
        <Ionicons name="location" size={16} color={EDITORIAL.green} />
        <Text style={s.locationText} numberOfLines={1}>{d.locationLabel}</Text>
        <Ionicons name="chevron-down" size={12} color={EDITORIAL.green} />
      </Pressable>
      <DiscoveryViewToggle map onPress={onShowList} />
    </View>
    <KeyboardAvoidingView style={s.foreground} behavior="padding" pointerEvents="box-none">
      <View style={s.spacer} pointerEvents="none" />
      <View testID="map-tray" style={[s.tray, { marginBottom: tabBarClearance }]} onLayout={event => setTrayHeight(event.nativeEvent.layout.height)}>
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
        {!d.loading && !d.error && pins.length === 0 && <View style={s.status}>
          <Text style={s.heading}>{visibleResults.length ? 'These spots have no map location' : emptyTitle}</Text>
          <Text style={s.body}>{visibleResults.length ? 'Open the list to explore every result.' : 'Try another dish or area, or adjust your meal targets.'}</Text>
          <Pressable style={s.action} onPress={() => d.setFilterVisible(true)} testID="discovery-empty-edit" accessibilityRole="button"><Text style={s.link}>Adjust meal targets</Text></Pressable>
          {d.hasQuery && <Pressable style={s.action} onPress={d.handleClearQuery} testID="discovery-empty-clear" accessibilityRole="button"><Text style={s.link}>Clear search</Text></Pressable>}
        </View>}
        {selected && <View testID="map-preview" style={s.previewRow}>
          <Pressable onPress={() => open(selected)} style={s.preview} testID="map-preview-open"
            accessibilityRole="button" accessibilityLabel={`Open ${mapRestaurantLabel(selected)}`}>
            <RestaurantPhoto uri={selected.photoUrl} name={selected.name} style={s.previewPhoto} thumbnail />
            <View style={s.previewCopy}>
              <Text style={s.heading} numberOfLines={2}>{selected.name}</Text>
              <Text style={s.body} numberOfLines={1}>{selected.cuisineTags.join(', ') || 'Restaurant'}{Number.isFinite(selected.distanceMiles) ? ` · ${selected.distanceMiles.toFixed(1)} mi` : ''}</Text>
              <Text style={s.previewLink}>View menu →</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={EDITORIAL.green} />
          </Pressable>
          <Pressable onPress={() => setSelectedId(undefined)} style={s.close} testID="map-preview-close" accessibilityRole="button" accessibilityLabel="Close restaurant preview">
            <Ionicons name="close" size={18} color={EDITORIAL.green} />
          </Pressable>
        </View>}
        {pins.length > 0 && <View style={s.caption}>
          <View style={s.captionCopy}><Text style={s.heading}>Spots near you</Text><Text style={s.body}>See what’s popping 🔥</Text></View>
          <Pressable testID="map-previous-spot" style={s.arrow} disabled={index <= 0} onPress={() => select(pins[index - 1])} accessibilityRole="button" accessibilityLabel="Previous spot" accessibilityState={{ disabled: index <= 0 }}>
            <Ionicons name="chevron-back" size={19} color={index <= 0 ? EDITORIAL.textSoft : EDITORIAL.green} />
          </Pressable>
          <Text style={s.body} testID="map-page">{index < 0 ? `${pins.length} spots` : `${index + 1} / ${pins.length}`}</Text>
          <Pressable testID="map-next-spot" style={s.arrow} disabled={index === pins.length - 1} onPress={() => select(pins[index + 1])} accessibilityRole="button" accessibilityLabel="Next spot" accessibilityState={{ disabled: index === pins.length - 1 }}>
            <Ionicons name="chevron-forward" size={19} color={EDITORIAL.green} />
          </Pressable>
        </View>}
        {pins.length > 1 && <View style={s.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {pins.slice(Math.max(0, index - 2), Math.max(0, index - 2) + 5).map(result => <View key={result.id} style={[s.dot, result.id === selectedId && s.activeDot]} />)}
        </View>}
        {d.nextCursor && !d.locked && !d.loading && <Pressable style={s.more} disabled={d.loadingMore || d.refreshing} onPress={() => { void d.handleEndReached(); }} testID="map-load-more" accessibilityRole="button" accessibilityState={{ disabled: d.loadingMore || d.refreshing }}>
          <Text style={s.link}>{d.loadingMore ? 'Loading more…' : 'More spots'}</Text>
        </Pressable>}
        <SearchBar value={d.query} onChangeText={d.setQuery} onClear={d.handleClearQuery}
          placeholder="Search spots, dishes, or vibes…" action={<ShuffleButton disabled={!d.canShuffle} onPress={d.handleShuffle} />} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
          {(['calories', 'protein', 'carbs', 'fat'] as const).map((key, position) => <Pressable key={key}
            style={s.chip} onPress={() => d.setFilterVisible(true)} testID={position === 0 ? 'preview-edit-targets' : `map-filter-${key}`}
            accessibilityRole="button" accessibilityLabel={`Edit ${key === 'calories' ? 'calories per meal' : `${key} grams`}, ${d.inputs[key] || 'not set'}`}>
            <Text style={s.chipText}>{d.inputs[key] || 'Any'}{d.inputs[key] && key !== 'calories' ? 'g' : ''} {key === 'calories' ? 'kcal' : key}</Text>
          </Pressable>)}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </View>;
}
