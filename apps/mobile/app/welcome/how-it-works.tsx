import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';

export default function HowItWorksScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: EDITORIAL.cream }}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={EDITORIAL.textSoft} />
          </Pressable>
        </View>

        <Text style={styles.headline}>Two sources.{'\n'}One goal.</Text>
        <Text style={styles.sub}>Accurate macros for every restaurant.</Text>

        <View style={styles.panels}>
          <View style={styles.panel}>
            <View style={[styles.badge, { backgroundColor: EDITORIAL.green }]}>
              <Ionicons name="checkmark-circle" size={18} color={EDITORIAL.cream} />
              <Text style={styles.badgeText}>VERIFIED</Text>
            </View>
            <Text style={styles.panelTitle}>Chain restaurants</Text>
            <Text style={styles.panelDesc}>
              Published nutrition data from official sources. McDonald's, Chick-fil-A, Jollibee — exact macros.
            </Text>
          </View>

          <View style={styles.panel}>
            <View style={[styles.badge, { backgroundColor: EDITORIAL.greenAccent }]}>
              <Ionicons name="sparkles" size={18} color={EDITORIAL.cream} />
              <Text style={styles.badgeText}>AI ESTIMATED</Text>
            </View>
            <Text style={styles.panelTitle}>Local restaurants</Text>
            <Text style={styles.panelDesc}>
              AI analyzes menus from Uber Eats and restaurant websites. Every estimate includes a confidence score.
            </Text>
          </View>
        </View>

        <View style={styles.spacer} />

        <Pressable
          style={styles.ctaBtn}
          onPress={() => router.push('/welcome/payment')}
        >
          <Text style={styles.ctaTxt}>Start free trial</Text>
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
    fontSize: 30,
    color: EDITORIAL.text,
    letterSpacing: -0.8,
    lineHeight: 36,
    marginBottom: 6,
  },
  sub: { fontSize: 15, color: EDITORIAL.textSoft, marginBottom: 28 },
  panels: { gap: 16 },
  panel: {
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    padding: 20,
    gap: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: { fontSize: 10, fontWeight: '800', color: EDITORIAL.cream, letterSpacing: 1 },
  panelTitle: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 20,
    color: EDITORIAL.text,
    letterSpacing: -0.3,
  },
  panelDesc: { fontSize: 14, lineHeight: 21, color: EDITORIAL.textSoft },
  spacer: { flex: 1 },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: EDITORIAL.green, borderRadius: 14, paddingVertical: 16,
  },
  ctaTxt: { fontSize: 16, fontWeight: '700', color: EDITORIAL.cream },
});
