import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';

export function ScreenHeader() {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.logoRow}>
        <Ionicons name="restaurant" size={18} color={colors.accent} />
        <Text style={[styles.logo, { color: colors.accent }]}>fitsy</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 12,
    backgroundColor: 'transparent',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logo: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
});
