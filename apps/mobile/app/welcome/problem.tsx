import React from 'react';
import { Dimensions, Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { EDITORIAL, FONTS } from '@/lib/brand';

const { height: SCREEN_H } = Dimensions.get('window');

export default function ProblemScreen() {
  return (
    <View style={styles.container}>
      <Image
        source={{ uri: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80' }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      <LinearGradient
        colors={['transparent', 'rgba(20,44,28,0.85)', 'rgba(20,44,28,0.95)']}
        locations={[0.2, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.content}>
        <View style={styles.spacer} />
        <View style={styles.textBlock}>
          <Text style={styles.headline}>
            You don't want to cook.
          </Text>
          <Text style={styles.subline}>
            But you also don't want to blow your macros.
          </Text>
        </View>
        <Pressable
          style={styles.ctaBtn}
          onPress={() => router.push('/welcome/promise')}
          accessibilityRole="button"
        >
          <Text style={styles.ctaTxt}>So what do you do?</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingBottom: 40,
    justifyContent: 'flex-end',
  },
  spacer: { flex: 1 },
  textBlock: { marginBottom: 32 },
  headline: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 36,
    color: EDITORIAL.cream,
    letterSpacing: -1,
    lineHeight: 42,
    marginBottom: 12,
  },
  subline: {
    fontSize: 18,
    color: 'rgba(253,251,247,0.7)',
    lineHeight: 26,
  },
  ctaBtn: {
    backgroundColor: 'rgba(253,251,247,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(253,251,247,0.3)',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaTxt: {
    fontSize: 16,
    fontWeight: '600',
    color: EDITORIAL.cream,
  },
});
