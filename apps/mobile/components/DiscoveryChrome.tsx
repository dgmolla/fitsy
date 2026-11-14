import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MacroValues } from '@/lib/macroPresets';
import { EDITORIAL } from '@/lib/brand';
import { BlurFallback } from '@/lib/BlurFallback';
import { DiscoveryViewToggle } from './DiscoveryViewToggle';
import { ShuffleButton } from './ShuffleButton';
import { s } from './DiscoveryScreen.styles';
import { s as map } from './DiscoveryMap.styles';

function getSelectionLabel(): string {
  const hour = new Date().getHours();
  if (hour < 11) return 'THE MORNING SELECTION';
  if (hour < 17) return 'THE MIDDAY SELECTION';
  return 'THE EVENING SELECTION';
}

export function Masthead({
  locationLabel,
  onLocationPress,
  locationRef,
  preview = false,
  mapControl,
}: {
  preview?: boolean;
  locationLabel: string;
  onLocationPress: () => void;
  locationRef?: React.RefObject<View | null>;
  mapControl?: { onPress: () => void };
}) {
  return (
    <View style={[s.masthead, !preview && s.mainMasthead]}>
      <View style={s.mastheadTop}>
        {preview ? <Text style={s.previewHeading}>Your first picks</Text> : <View style={s.logoRow}>
          <View style={s.logoDot} />
          <Text style={s.logo}>fitsy</Text>
        </View>}
        <View ref={locationRef} collapsable={false} style={s.locationAnchor}>
          {mapControl ? <DiscoveryViewToggle map={false} onPress={mapControl.onPress} style={chrome.mapButton} /> : <TouchableOpacity
          style={s.locationButton}
          onPress={onLocationPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Location: ${locationLabel}`}
          accessibilityHint="Double-tap to change location"
          testID="discovery-location"
        >
          <View style={s.locationChip} testID="discovery-location-pill">
            <Ionicons name="location" size={11} color={EDITORIAL.greenAccent} />
            <Text style={s.locationText} numberOfLines={1}>{locationLabel}</Text>
            <Ionicons name="chevron-down" size={10} color={EDITORIAL.textSoft} />
          </View>
        </TouchableOpacity>}</View>
      </View>
      {!preview && <Text style={s.issueLabel} numberOfLines={1}>{mapControl ? `YOUR PICKS NEAR ${locationLabel}` : getSelectionLabel()}</Text>}
    </View>
  );
}

// ─── Discovery toolbar (real search screen) ────────────────────────────────────

// Reuses the map screen's own pill styles so the search bar and controls match
// it exactly, on the same row layout, instead of drifting from a second,
// independently-styled header (#824). No logo, no "picks" heading, no macro
// values - just the search bar and the same location/Macros/Shuffle/view
// controls the map shows, matched pill-for-pill.
export function DiscoveryToolbar({
  query,
  onQueryChange,
  onClear,
  searchRef,
  locationLabel,
  onLocationPress,
  locationRef,
  onMacrosPress,
  canShuffle,
  onShuffle,
  onViewToggle,
}: {
  query: string;
  onQueryChange: (text: string) => void;
  onClear: () => void;
  searchRef?: React.RefObject<View | null>;
  locationLabel?: string;
  onLocationPress?: () => void;
  locationRef?: React.RefObject<View | null>;
  onMacrosPress: () => void;
  canShuffle: boolean;
  onShuffle: () => void;
  onViewToggle?: () => void;
}) {
  return (
    <View style={toolbar.wrap} testID="discovery-toolbar">
      <SearchBar value={query} onChangeText={onQueryChange} onClear={onClear} containerRef={searchRef} frosted />
      <View style={map.topRow}>
        {/* Location lives on the map when it's available (#829) - the map stays
            mounted under this sheet. Without a map (map-search flag off), this
            is the only way to change or clear the search area, so keep it here. */}
        {!onViewToggle && locationLabel !== undefined && onLocationPress && (
          <Pressable ref={locationRef} collapsable={false} style={map.location} testID="discovery-location" onPress={onLocationPress}
            accessibilityRole="button" accessibilityLabel={`Location: ${locationLabel}`} accessibilityHint="Change search area">
            <Ionicons name="location" size={15} color={EDITORIAL.green} />
            <Text style={map.locationText} numberOfLines={1}>{locationLabel}</Text>
            <Ionicons name="chevron-down" size={12} color={EDITORIAL.green} />
          </Pressable>
        )}
        <Pressable style={map.goals} testID="discovery-goals" onPress={onMacrosPress}
          accessibilityRole="button" accessibilityLabel="Edit macros">
          <Ionicons name="options-outline" size={16} color={EDITORIAL.green} /><Text style={map.locationText}>Macros</Text>
        </Pressable>
        <ShuffleButton style={map.shuffle} disabled={!canShuffle} onPress={onShuffle} testID="discovery-shuffle-button" />
        {onViewToggle && <DiscoveryViewToggle map={false} onPress={onViewToggle} />}
      </View>
    </View>
  );
}

const toolbar = StyleSheet.create({
  wrap: { backgroundColor: EDITORIAL.cream, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 8 },
});

// ─── Macro strip ──────────────────────────────────────────────────────────────

export function MacroStrip({ macros, onEdit, editRef }: { macros: MacroValues; onEdit: () => void; editRef?: React.RefObject<View | null> }) {
  const p = macros.protein || '-';
  const c = macros.carbs || '-';
  const f = macros.fat || '-';
  const cal = macros.calories || '-';

  return (
    <View style={s.macroStrip} testID="discovery-macro-strip">
      <View style={s.macroItem}>
        <Text style={s.macroVal}>{p}g</Text>
        <Text style={s.macroLbl}>protein</Text>
      </View>
      <View style={s.macroDivider} />
      <View style={s.macroItem}>
        <Text style={s.macroVal}>{c}g</Text>
        <Text style={s.macroLbl}>carbs</Text>
      </View>
      <View style={s.macroDivider} />
      <View style={s.macroItem}>
        <Text style={s.macroVal}>{f}g</Text>
        <Text style={s.macroLbl}>fat</Text>
      </View>
      <View style={s.macroDivider} />
      <View style={s.macroItem}>
        <Text style={s.macroVal}>{cal}</Text>
        <Text style={s.macroLbl}>kcal/meal</Text>
      </View>
      <View ref={editRef} collapsable={false}>
        <TouchableOpacity
          style={s.editButton}
          onPress={onEdit}
          activeOpacity={0.7}
          accessibilityLabel="Edit macro targets"
          testID="preview-edit-targets"
          accessibilityRole="button"
        >
          <View style={s.editBtn} testID="discovery-edit-pill"><Text style={s.editBtnText}>Edit</Text></View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Search bar ───────────────────────────────────────────────────────────────

// Persistent horizontal search row. Styled to match the restaurant detail
// screen's menu search input (⌕ glyph + × clear, creamCard pill, see
// app/restaurant/[id].tsx).
export function SearchBar({
  value,
  onChangeText,
  onClear,
  containerRef,
  action,
  placeholder = 'Search restaurants or dishes',
  frosted = false,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  containerRef?: React.RefObject<View | null>;
  action?: React.ReactNode;
  placeholder?: string;
  frosted?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View ref={containerRef} collapsable={false} style={[s.search, frosted && chrome.search, frosted && focused && chrome.searchFocused]} testID="discovery-search-bar">
      {frosted && <FrostedSearchSurface />}
      <Text style={s.searchIco}>⌕</Text>
      <TextInput
        style={s.searchInput}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={EDITORIAL.textSoft}
        returnKeyType="search"
        maxLength={100}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="never"
        accessibilityLabel="Search restaurants or dishes"
        testID="discovery-search"
      />
      {value !== '' && (
        <Pressable onPress={onClear} testID="discovery-clear-search" hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
          <Text style={s.searchClear}>×</Text>
        </Pressable>
      )}
      {action}
    </View>
  );
}

// The same installed blur treatment stays cool white at rest, while typing,
// and after submission. Its decorative layers never intercept input.
export function FrostedSearchSurface() {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <BlurFallback tint="light" intensity={60} fallbackColor="rgba(255,255,255,0.9)" />
    <View style={[StyleSheet.absoluteFill, chrome.frostTint]} />
  </View>;
}

const chrome = StyleSheet.create({
  mapButton: { backgroundColor: 'rgba(255,255,255,0.8)' },
  search: { backgroundColor: 'rgba(255,255,255,0.8)', borderColor: 'rgba(58,112,80,0.2)', borderRadius: 24, overflow: 'hidden', minHeight: 48, paddingVertical: 2 },
  searchFocused: { borderColor: EDITORIAL.greenAccent },
  frostTint: { backgroundColor: 'rgba(255,255,255,0.68)' },
});
