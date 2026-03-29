import React from 'react';
import { Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { BRAND } from '@/lib/brand';

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
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        {/* Hero */}
        <View style={styles.hero}>
          <Image
            source={require('@/assets/illustrations/welcome.png')}
            style={{ width: 180, height: 180 }}
            resizeMode="contain"
          />
          <Text style={[styles.wordmark, { color: BRAND.color }]}>{BRAND.name}</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            Eat well, wherever you go.
          </Text>
        </View>

        {/* Value props */}
        <View style={styles.props}>
          {VALUE_PROPS.map((vp) => (
            <View key={vp.title} style={styles.propRow}>
              <View style={[styles.iconWrap, { backgroundColor: BRAND.color + '18' }]}>
                <Ionicons name={vp.icon} size={22} color={BRAND.color} />
              </View>
              <View style={styles.propText}>
                <Text style={[styles.propTitle, { color: colors.textPrimary }]}>{vp.title}</Text>
                <Text style={[styles.propDesc, { color: colors.textSecondary }]}>{vp.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* CTA */}
        <View style={styles.actions}>
          <Pressable
            style={[styles.ctaBtn, { backgroundColor: BRAND.color }]}
            onPress={() => router.push('/welcome/age')}
            accessibilityRole="button"
            accessibilityLabel="Get Started"
          >
            <Text style={styles.ctaTxt}>Get Started</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>

          <Pressable
            onPress={() => router.push('/auth/login')}
            accessibilityRole="button"
            accessibilityLabel="Already have an account? Log in"
          >
            <Text style={[styles.loginHint, { color: colors.textTertiary }]}>
              Already have an account?{' '}
              <Text style={{ color: BRAND.color, fontWeight: '600' }}>Log in</Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
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
    fontWeight: '800',
    letterSpacing: BRAND.letterSpacing,
  },
  tagline: { fontSize: 16, textAlign: 'center' },
  props: { gap: 20 },
  propRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  propText: { flex: 1 },
  propTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  propDesc: { fontSize: 13, lineHeight: 19 },
  actions: { gap: 16, alignItems: 'center' },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
    width: '100%',
    shadowColor: BRAND.color,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaTxt: { fontSize: 16, fontWeight: '700', color: '#fff' },
  loginHint: { fontSize: 14, textAlign: 'center' },
});
