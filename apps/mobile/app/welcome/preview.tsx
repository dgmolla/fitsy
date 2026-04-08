import React from 'react';
import { Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';

const PREVIEW_RESTAURANTS = [
  { name: 'Pine and Crane', dish: 'Beef Noodle Soup', cal: 580, p: 32, dist: '0.4 mi', img: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&q=70' },
  { name: 'Great White', dish: 'Salmon Coconut Curry', cal: 520, p: 38, dist: '0.8 mi', img: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=400&q=70' },
  { name: 'Luv2eat Thai', dish: 'Pad Thai', cal: 490, p: 28, dist: '1.2 mi', img: 'https://images.unsplash.com/photo-1559314809-0d155014e29e?w=400&q=70' },
];

function PreviewCard({ r, index }: { r: typeof PREVIEW_RESTAURANTS[0]; index: number }) {
  return (
    <View style={styles.card}>
      <Image source={{ uri: r.img }} style={styles.cardImage} resizeMode="cover" />
      <LinearGradient colors={['transparent', EDITORIAL.heroGrad]} style={styles.cardGradient} />
      <View style={styles.cardInfo}>
        <Text style={styles.cardIndex}>{String(index + 1).padStart(2, '0')}</Text>
        <View style={styles.cardText}>
          <Text style={styles.cardName}>{r.name}</Text>
          <Text style={styles.cardDish}>{r.dish} · {r.cal} kcal · P {r.p}g</Text>
        </View>
        <Text style={styles.cardDist}>{r.dist}</Text>
      </View>
    </View>
  );
}

export default function PreviewScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: EDITORIAL.cream }}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={EDITORIAL.textSoft} />
          </Pressable>
        </View>

        <Text style={styles.headline}>Let's find your first meal.</Text>
        <Text style={styles.sub}>Restaurants near you, matched to your targets.</Text>

        <View style={styles.cards}>
          {PREVIEW_RESTAURANTS.map((r, i) => (
            <PreviewCard key={r.name} r={r} index={i} />
          ))}
        </View>

        <View style={styles.spacer} />

        <Pressable
          style={styles.ctaBtn}
          onPress={() => router.push('/welcome/how-it-works')}
        >
          <Text style={styles.ctaTxt}>How does it work?</Text>
          <Ionicons name="arrow-forward" size={18} color={EDITORIAL.cream} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 24, paddingBottom: 32 },
  header: { paddingTop: 8, paddingBottom: 12 },
  headline: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 28,
    color: EDITORIAL.text,
    letterSpacing: -0.8,
    marginBottom: 6,
  },
  sub: { fontSize: 15, color: EDITORIAL.textSoft, marginBottom: 20 },
  cards: { gap: 12 },
  card: {
    height: 90,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: EDITORIAL.creamDeep,
  },
  cardImage: { width: '100%', height: '100%' },
  cardGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '100%' },
  cardInfo: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    padding: 12, gap: 10,
  },
  cardIndex: {
    fontSize: 11, fontWeight: '800', color: 'rgba(253,251,247,0.5)', letterSpacing: 0.5,
  },
  cardText: { flex: 1 },
  cardName: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 16, color: EDITORIAL.cream, letterSpacing: -0.3,
  },
  cardDish: { fontSize: 11, color: 'rgba(253,251,247,0.65)' },
  cardDist: { fontSize: 11, fontWeight: '600', color: 'rgba(253,251,247,0.5)' },
  spacer: { flex: 1 },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: EDITORIAL.green, borderRadius: 14, paddingVertical: 16,
  },
  ctaTxt: { fontSize: 16, fontWeight: '700', color: EDITORIAL.cream },
});
