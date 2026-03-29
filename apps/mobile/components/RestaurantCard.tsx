import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { RestaurantResult } from '@fitsy/shared';
import { ConfidenceBadge } from './ConfidenceBadge';
import { useTheme } from '@/lib/theme';

interface Props {
  item: RestaurantResult;
  onPress?: () => void;
}

// Deterministic placeholder color from name
function placeholderColor(name: string): string {
  const COLORS = [
    '#2D6A4F', '#40916C', '#1B4332', '#52796F',
    '#354F52', '#2F3E46', '#84A98C', '#3D5A80',
    '#5C4033', '#6D4C41', '#4A4E69', '#22577A',
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function RestaurantCard({ item, onPress }: Props) {
  const { colors, mode } = useTheme();
  const distanceLabel = `${item.distanceMiles.toFixed(1)} mi`;
  const isHighConfidence = item.bestMatch?.confidence === 'HIGH';
  const initials = item.name.slice(0, 2).toUpperCase();
  const bgColor = placeholderColor(item.name);

  const gradientColors: [string, string] =
    mode === 'dark'
      ? ['transparent', 'rgba(0,0,0,0.72)']
      : ['transparent', 'rgba(0,0,0,0.55)'];

  return (
    <TouchableOpacity
      style={styles.cardWrapper}
      onPress={onPress}
      activeOpacity={onPress ? 0.75 : 1}
      accessibilityRole="button"
      accessibilityLabel={`View menu for ${item.name}`}
    >
      <View style={[styles.card, {
        backgroundColor: colors.bgCard,
        borderColor: colors.border,
        shadowColor: colors.glassShadowColor,
        shadowOpacity: colors.glassShadowOpacity,
        shadowRadius: colors.glassShadowRadius,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
      }]}>

        {/* ─── Hero image ─────────────────────────────────────────────────── */}
        <View style={styles.imageContainer}>
          {item.photoUrl ? (
            <Image
              source={{ uri: item.photoUrl }}
              style={styles.image}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.imagePlaceholder, { backgroundColor: bgColor }]}>
              <Text style={styles.placeholderInitials}>{initials}</Text>
            </View>
          )}

          {/* gradient overlay — name + meta float over image */}
          <LinearGradient
            colors={gradientColors}
            style={styles.imageGradient}
            pointerEvents="none"
          />

          {/* name + distance over image */}
          <View style={styles.imageOverlay}>
            <Text style={styles.imageOverlayName} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.distanceRow}>
              <Ionicons name="navigate-outline" size={11} color="rgba(255,255,255,0.7)" />
              <Text style={styles.imageOverlayDistance}>{distanceLabel}</Text>
            </View>
          </View>

          {/* high-confidence accent strip */}
          {isHighConfidence && (
            <View style={[styles.accentDot, { backgroundColor: colors.accent }]} />
          )}
        </View>

        {/* ─── Card body ──────────────────────────────────────────────────── */}
        <View style={styles.cardBody}>
          {/* address + cuisine tags */}
          <View style={styles.metaRow}>
            <Text style={[styles.address, { color: colors.textTertiary }]} numberOfLines={1}>
              {item.address}
            </Text>
          </View>

          {item.cuisineTags.length > 0 && (
            <View style={styles.tagsRow}>
              {item.cuisineTags.slice(0, 3).map((tag) => (
                <View
                  key={tag}
                  style={[styles.cuisineTag, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}
                >
                  <Text style={[styles.cuisineTagText, { color: colors.textSecondary }]}>
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* divider */}
          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          {/* best match */}
          {item.bestMatch ? (
            <View style={styles.bestMatch}>
              <View style={styles.bestMatchRow}>
                <Text
                  style={[styles.bestMatchName, { color: colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {item.bestMatch.name}
                </Text>
                <ConfidenceBadge confidence={item.bestMatch.confidence} />
              </View>
              <View style={styles.macroRow}>
                <View style={[styles.macroChip, { backgroundColor: colors.bgElevated }]}>
                  <Text style={[styles.macroChipLabel, { color: colors.textTertiary }]}>CALS</Text>
                  <Text style={[styles.macroChipVal, { color: colors.textPrimary }]}>{item.bestMatch.calories}</Text>
                </View>
                <View style={[styles.macroChip, { backgroundColor: colors.bgElevated }]}>
                  <Text style={[styles.macroChipLabel, { color: colors.textTertiary }]}>PRO</Text>
                  <Text style={[styles.macroChipVal, { color: colors.textPrimary }]}>{item.bestMatch.proteinG}g</Text>
                </View>
                <View style={[styles.macroChip, { backgroundColor: colors.bgElevated }]}>
                  <Text style={[styles.macroChipLabel, { color: colors.textTertiary }]}>CARBS</Text>
                  <Text style={[styles.macroChipVal, { color: colors.textPrimary }]}>{item.bestMatch.carbsG}g</Text>
                </View>
                <View style={[styles.macroChip, { backgroundColor: colors.bgElevated }]}>
                  <Text style={[styles.macroChipLabel, { color: colors.textTertiary }]}>FAT</Text>
                  <Text style={[styles.macroChipVal, { color: colors.textPrimary }]}>{item.bestMatch.fatG}g</Text>
                </View>
                {isHighConfidence && (
                  <View style={[styles.matchBadge, {
                    backgroundColor: colors.accentBg,
                    borderColor: colors.accentBorder,
                  }]}>
                    <Text style={[styles.matchBadgeText, { color: colors.accent }]}>Match</Text>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <Text style={[styles.noMacro, { color: colors.textTertiary }]}>
              No macro data available
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    marginHorizontal: 16,
    marginVertical: 6,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },

  // ─── Image ─────────────────────────────────────────────────────────────────
  imageContainer: {
    height: 152,
    width: '100%',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderInitials: {
    fontSize: 40,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 2,
  },
  imageGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  imageOverlayName: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
  },
  imageOverlayDistance: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
  },
  accentDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // ─── Body ──────────────────────────────────────────────────────────────────
  cardBody: {
    padding: 14,
    gap: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  address: {
    flex: 1,
    fontSize: 12,
    fontWeight: '400',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: -2,
  },
  cuisineTag: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  cuisineTagText: {
    fontSize: 11,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    marginVertical: 2,
  },
  bestMatch: {
    gap: 8,
  },
  bestMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bestMatchName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
    letterSpacing: -0.2,
  },
  macroRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  macroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  macroChipLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  macroChipVal: {
    fontSize: 13,
    fontWeight: '700',
  },
  matchBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  matchBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  noMacro: {
    fontSize: 13,
    fontStyle: 'italic',
  },
});
