import React from 'react';
import { Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const VALUE_PROPS: { icon: IoniconsName; title: string; desc: string }[] = [
  {
    icon: 'search-outline',
    title: 'Find meals that hit your macros',
    desc: 'Search nearby restaurants filtered by your protein, carb, and fat targets.',
  },
  {
    icon: 'person-outline',
    title: 'Targets built around you',
    desc: 'We calculate your daily macros based on your body, goals, and activity level.',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Nutritional confidence scores',
    desc: 'Every estimate comes with a confidence rating so you always know what to trust.',
  },
];

export default function WelcomeSplash() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: EDITORIAL.cream }}>
      <View style={styles.content}>
        {/* Hero */}
        <View style={styles.hero}>
          <Image
            source={require('@/assets/illustrations/welcome.png')}
            style={{ width: 180, height: 180 }}
            resizeMode="contain"
          />
          <Text style={styles.wordmark}>fitsy</Text>
          <Text style={styles.tagline}>Find food that fits</Text>
        </View>

        {/* Value props */}
        <View style={styles.props}>
          {VALUE_PROPS.map((vp) => (
            <View key={vp.title} style={styles.propRow}>
              <View style={styles.iconWrap}>
                <Ionicons name={vp.icon} size={22} color={EDITORIAL.greenAccent} />
              </View>
              <View style={styles.propText}>
                <Text style={styles.propTitle}>{vp.title}</Text>
                <Text style={styles.propDesc}>{vp.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* CTA */}
        <View style={styles.actions}>
          <Pressable
            style={styles.ctaBtn}
            onPress={() => router.push('/welcome/age')}
            accessibilityRole="button"
            accessibilityLabel="Get Started"
          >
            <Text style={styles.ctaTxt}>Get Started</Text>
            <Ionicons name="arrow-forward" size={18} color={EDITORIAL.cream} />
          </Pressable>

          <Pressable
            onPress={() => router.push('/auth/login')}
            accessibilityRole="button"
            accessibilityLabel="Already have an account? Log in"
          >
            <Text style={styles.loginHint}>
              Already have an account?{' '}
              <Text style={{ color: EDITORIAL.greenAccent, fontWeight: '600' }}>Log in</Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingTop: 32,
    paddingBottom: 32,
  },
  hero: { alignItems: 'center', gap: 8 },
  wordmark: {
    fontSize: 42,
    fontFamily: FONTS.newsreaderBold,
    color: EDITORIAL.green,
    letterSpacing: -1.5,
  },
  tagline: { fontSize: 16, textAlign: 'center', color: EDITORIAL.textSoft },
  props: { gap: 20 },
  propRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: EDITORIAL.creamDeep,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  propText: { flex: 1 },
  propTitle: { fontSize: 15, fontWeight: '600', color: EDITORIAL.text, marginBottom: 2 },
  propDesc: { fontSize: 13, lineHeight: 19, color: EDITORIAL.textSoft },
  actions: { gap: 16, alignItems: 'center' },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: EDITORIAL.green,
    borderRadius: 14,
    paddingVertical: 16,
    width: '100%',
    shadowColor: EDITORIAL.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaTxt: { fontSize: 16, fontWeight: '700', color: EDITORIAL.cream },
  loginHint: { fontSize: 14, textAlign: 'center', color: EDITORIAL.textSoft },
});
