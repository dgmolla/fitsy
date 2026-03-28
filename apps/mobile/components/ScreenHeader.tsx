import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { BRAND } from '@/lib/brand';

export function ScreenHeader() {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <Text style={[styles.logo, { color: BRAND.color }]}>{BRAND.name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
  },
  logo: {
    fontSize: 30,
    fontWeight: BRAND.fontWeight,
    letterSpacing: BRAND.letterSpacing,
  },
});
