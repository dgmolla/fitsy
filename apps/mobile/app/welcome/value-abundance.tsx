import React, { useEffect } from 'react';
import { Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { AnimatedPress } from '@/components/AnimatedPress';
import { trackOnboardingScreenView } from '@/lib/analytics';

const IMG = (id: string) => `https://images.unsplash.com/photo-${id}?w=400&q=70`;

// Meal mosaic — world-cuisine dishes (no burgers). Distributed into 3 columns
// for a masonry feel; varied heights + a bottom fade read as "there's more".
// Placeholder photography — swap real imagery before launch.
type Tile = { uri: string; h: number; chip?: string; macro?: boolean };
const COLUMNS: Tile[][] = [
  [
    { uri: IMG('1569718212165-3a8278d5f624'), h: 150, chip: '✓ FITS' }, // ramen
    { uri: IMG('1559314809-0d155014e29e'), h: 104 },                    // thai noodles
    { uri: IMG('1540420773420-3366772f4999'), h: 124 },                 // mezze
  ],
  [
    { uri: IMG('1565557623262-b51c2513a641'), h: 110, chip: '52g P', macro: true }, // tikka masala
    { uri: IMG('1512621776951-a57141f2eefd'), h: 130 },                 // grain salad
    { uri: IMG('1467003909585-2f8a72700288'), h: 100 },                 // salmon
  ],
  [
    { uri: IMG('1546069901-ba9599a7e63c'), h: 120, chip: '✓ FITS' },    // poke bowl
    { uri: IMG('1496116218417-1a781b1c416c'), h: 108 },                 // dumplings
    { uri: IMG('1528735602780-2552fd46c7af'), h: 116, chip: '48g P', macro: true }, // wrap
  ],
];

function MosaicTile({ tile }: { tile: Tile }) {
  return (
    <View style={[s.tile, { height: tile.h }]}>
      <Image source={{ uri: tile.uri }} style={s.tileImg} resizeMode="cover" />
      {tile.chip ? (
        <View style={[s.chip, tile.macro ? s.chipMacro : null]}>
          <Text style={[s.chipTxt, tile.macro ? s.chipTxtMacro : null]}>{tile.chip}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function ValueAbundanceScreen() {
  useEffect(() => {
    trackOnboardingScreenView('value_abundance');
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={16} style={s.back} accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color={EDITORIAL.textMid} />
          </Pressable>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round((5 / 18) * 100)}%` }]} />
          </View>
        </View>

        <Animated.Text entering={FadeInDown.duration(500)} style={s.headline}>
          So much of it{'\n'}already fits.
        </Animated.Text>
        <Animated.Text entering={FadeInDown.duration(500).delay(100)} style={s.body}>
          There's way more food around you that hits your goals than you'd ever guess — you just can't see it yet.
        </Animated.Text>

        <Animated.View entering={FadeIn.duration(500).delay(220)} style={s.mosaic}>
          <View style={s.mosaicRow}>
            {COLUMNS.map((col, ci) => (
              <View key={ci} style={[s.col, ci < 2 ? s.colGap : null]}>
                {col.map((tile, ti) => (
                  <View key={ti} style={ti > 0 ? s.tileGap : null}>
                    <MosaicTile tile={tile} />
                  </View>
                ))}
              </View>
            ))}
          </View>
          <LinearGradient
            colors={['transparent', EDITORIAL.cream]}
            style={s.fade}
            pointerEvents="none"
          />
        </Animated.View>

        <View style={{ flex: 1 }} />

        <Animated.View entering={FadeIn.duration(400).delay(380)}>
          <AnimatedPress style={s.cta} onPress={() => router.push('/welcome/value-payoff')} haptic accessibilityRole="button">
            <Text style={s.ctaTxt}>Show me</Text>
            <Ionicons name="arrow-forward" size={15} color={EDITORIAL.cream} />
          </AnimatedPress>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const MOSAIC_H = 318;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  content: { flex: 1, paddingHorizontal: 36, paddingBottom: 40 },

  topBar: { flexDirection: 'row', alignItems: 'center', height: 52 },
  back: { width: 44, height: 44, justifyContent: 'center' },
  progressTrack: { flex: 1, height: 4, backgroundColor: EDITORIAL.border, borderRadius: 2, marginLeft: 12, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: EDITORIAL.greenAccent, borderRadius: 2 },

  headline: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 30, color: EDITORIAL.text, letterSpacing: -1.2, lineHeight: 38,
    marginBottom: 14, marginTop: 8,
  },
  body: { fontFamily: FONTS.nunitoSans, fontSize: 15, lineHeight: 22, color: EDITORIAL.textSoft, marginBottom: 18 },

  mosaic: { height: MOSAIC_H, overflow: 'hidden', borderRadius: 16 },
  mosaicRow: { flexDirection: 'row' },
  col: { flex: 1 },
  colGap: { marginRight: 7 },
  tileGap: { marginTop: 7 },
  tile: { borderRadius: 12, overflow: 'hidden', backgroundColor: EDITORIAL.creamDeep },
  tileImg: { width: '100%', height: '100%' },

  chip: { position: 'absolute', left: 7, bottom: 7, backgroundColor: 'rgba(27,58,38,0.92)', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4 },
  chipMacro: {},
  chipTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: '#9fe0b8' },
  chipTxtMacro: { color: '#FFFFFF' },

  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 56 },

  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18 },
  ctaTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
});
