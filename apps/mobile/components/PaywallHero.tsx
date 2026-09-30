import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DISHES } from '@/lib/dishImages';
import { EDITORIAL, FONTS } from '@/lib/brand';

/** An illustrative Fitsy result using the same dish photography as welcome. */
export function PaywallHero({ compact = false }: { compact?: boolean }) {
  return <View style={[s.hero, compact && s.heroCompact]} testID="paywall-hero" accessibilityLabel="Illustrative Fitsy meal result preview">
    <View style={s.mosaic} accessible={false} importantForAccessibility="no-hide-descendants">
      <Image source={DISHES[3]} style={[s.tile, s.tileOne]} />
      <Image source={DISHES[8]} style={[s.tile, s.tileTwo]} />
      <Image source={DISHES[14]} style={[s.tile, s.tileThree]} />
      <Image source={DISHES[19]} style={[s.tile, s.tileFour]} />
      <View style={s.softener} />
    </View>
    <View style={[s.preview, compact && s.previewCompact]}>
      <Image source={DISHES[0]} style={[s.mealPhoto, compact && s.mealPhotoCompact]} resizeMode="cover" accessibilityLabel="Illustrative chicken bowl" />
      <View style={[s.previewInfo, compact && s.previewInfoCompact]}>
        <Text style={s.previewEyebrow}>FITSY MEAL PREVIEW</Text>
        <Text style={[s.mealName, compact && s.mealNameCompact]} numberOfLines={1}>Chicken bowl</Text>
        <View style={[s.fitRow, compact && s.fitRowCompact]}><Ionicons name="sparkles" size={13} color={EDITORIAL.green} /><Text style={s.fitText}>Fit score for your goals</Text></View>
        <Text style={[s.macroHeading, compact && s.macroHeadingCompact]}>ESTIMATED NUTRITION</Text>
        <Text style={s.macros} numberOfLines={2}>Calories  ·  Protein  ·  Carbs  ·  Fat</Text>
      </View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  hero: { height: 178, marginBottom: 18, borderRadius: 22, overflow: 'hidden', backgroundColor: EDITORIAL.greenAccentTint, justifyContent: 'center' },
  heroCompact: { height: 130, marginBottom: 10 },
  mosaic: { ...StyleSheet.absoluteFillObject },
  tile: { position: 'absolute', width: '48%', height: 98, borderRadius: 13, opacity: 0.32 },
  tileOne: { left: -18, top: -34, transform: [{ rotate: '-9deg' }] },
  tileTwo: { right: -16, top: -31, transform: [{ rotate: '9deg' }] },
  tileThree: { left: -32, bottom: -40, transform: [{ rotate: '8deg' }] },
  tileFour: { right: -28, bottom: -40, transform: [{ rotate: '-8deg' }] },
  softener: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(253,251,247,0.43)' },
  preview: { marginHorizontal: 25, height: 136, borderRadius: 18, backgroundColor: EDITORIAL.cream, flexDirection: 'row', overflow: 'hidden', borderWidth: 1, borderColor: EDITORIAL.border, shadowColor: EDITORIAL.green, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 14, elevation: 4 },
  previewCompact: { marginHorizontal: 14, height: 108 },
  mealPhoto: { width: 104, height: '100%' },
  mealPhotoCompact: { width: 83 },
  previewInfo: { flex: 1, minWidth: 0, paddingHorizontal: 13, paddingVertical: 12, justifyContent: 'center' },
  previewInfoCompact: { paddingVertical: 7 },
  previewEyebrow: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 9, letterSpacing: 1.2, color: EDITORIAL.textMid },
  mealName: { fontFamily: FONTS.frauncesDisplayBold, fontSize: 19, lineHeight: 25, color: EDITORIAL.green, marginTop: 2 },
  mealNameCompact: { fontSize: 17, lineHeight: 21 },
  fitRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  fitRowCompact: { marginTop: 2 },
  fitText: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 10, color: EDITORIAL.green },
  macroHeading: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 8, letterSpacing: 0.8, color: EDITORIAL.textMid, marginTop: 9 },
  macroHeadingCompact: { marginTop: 5 },
  macros: { fontFamily: FONTS.nunitoSans, fontSize: 10, lineHeight: 14, color: EDITORIAL.green, marginTop: 1 },
});
