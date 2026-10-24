import React from 'react';
import { Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MacroValues } from '@/lib/macroPresets';
import { EDITORIAL } from '@/lib/brand';
import { s } from './DiscoveryScreen.styles';

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
}: {
  preview?: boolean;
  locationLabel: string;
  onLocationPress: () => void;
  locationRef?: React.RefObject<View | null>;
}) {
  return (
    <View style={[s.masthead, !preview && s.mainMasthead]}>
      <View style={s.mastheadTop}>
        {preview ? <Text style={s.previewHeading}>Your first picks</Text> : <View style={s.logoRow}>
          <View style={s.logoDot} />
          <Text style={s.logo}>fitsy</Text>
        </View>}
        <View ref={locationRef} collapsable={false} style={s.locationAnchor}><TouchableOpacity
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
        </TouchableOpacity></View>
      </View>
      {!preview && <Text style={s.issueLabel}>{getSelectionLabel()}</Text>}
    </View>
  );
}

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
}: {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  containerRef?: React.RefObject<View | null>;
}) {
  return (
    <View ref={containerRef} collapsable={false} style={s.search}>
      <Text style={s.searchIco}>⌕</Text>
      <TextInput
        style={s.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search restaurants or dishes"
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
    </View>
  );
}
