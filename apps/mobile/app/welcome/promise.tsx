import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';

export default function PromiseScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: EDITORIAL.cream }}>
      <View style={styles.content}>
        <View style={styles.spacer} />

        <View style={styles.center}>
          <Text style={styles.headline}>
            We find restaurants near you with meals that hit your targets.
          </Text>

          {/* Mocked search result card */}
          <View style={styles.mockCard}>
            <View style={styles.mockCardHeader}>
              <View style={styles.mockBadge}>
                <Text style={styles.mockBadgeText}>01</Text>
              </View>
              <Text style={styles.mockDist}>0.4 mi</Text>
            </View>
            <Text style={styles.mockName}>Pine and Crane</Text>
            <Text style={styles.mockDish}>Beef Noodle Soup</Text>
            <View style={styles.mockMacros}>
              <Text style={styles.mockMacro}>P 32g</Text>
              <Text style={styles.mockDot}>·</Text>
              <Text style={styles.mockMacro}>C 60g</Text>
              <Text style={styles.mockDot}>·</Text>
              <Text style={styles.mockMacro}>F 20g</Text>
              <Text style={styles.mockDot}>·</Text>
              <Text style={styles.mockCal}>580 kcal</Text>
            </View>
          </View>
        </View>

        <View style={styles.spacer} />

        <Pressable
          style={styles.ctaBtn}
          onPress={() => router.push('/welcome/goal')}
          accessibilityRole="button"
        >
          <Text style={styles.ctaTxt}>Let's personalize</Text>
          <Ionicons name="arrow-forward" size={18} color={EDITORIAL.cream} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  spacer: { flex: 1 },
  center: { gap: 32 },
  headline: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 28,
    color: EDITORIAL.text,
    letterSpacing: -0.8,
    lineHeight: 36,
    textAlign: 'center',
  },
  mockCard: {
    backgroundColor: EDITORIAL.green,
    borderRadius: 20,
    padding: 20,
    gap: 6,
  },
  mockCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  mockBadge: {
    backgroundColor: 'rgba(253,251,247,0.2)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  mockBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(253,251,247,0.9)',
    letterSpacing: 0.5,
  },
  mockDist: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(253,251,247,0.6)',
  },
  mockName: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 24,
    color: EDITORIAL.cream,
    letterSpacing: -0.5,
  },
  mockDish: {
    fontFamily: FONTS.newsreaderItalic,
    fontSize: 16,
    color: 'rgba(253,251,247,0.8)',
  },
  mockMacros: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  mockMacro: { fontSize: 12, fontWeight: '600', color: 'rgba(253,251,247,0.6)' },
  mockDot: { fontSize: 12, color: 'rgba(253,251,247,0.3)' },
  mockCal: { fontSize: 12, fontWeight: '700', color: 'rgba(253,251,247,0.9)' },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    borderRadius: 14,
    paddingVertical: 16,
    shadowColor: EDITORIAL.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaTxt: { fontSize: 16, fontWeight: '700', color: EDITORIAL.cream },
});
