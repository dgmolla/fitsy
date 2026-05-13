import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EDITORIAL, FONTS } from '@/lib/brand';

export function ScreenHeader() {
  return (
    <View style={styles.container}>
      <View style={styles.logoRow}>
        <View style={styles.logoDot} />
        <Text style={styles.logo}>fitsy</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 12,
    backgroundColor: EDITORIAL.cream,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  logoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: EDITORIAL.green,
  },
  logo: {
    fontSize: 24,
    fontFamily: FONTS.frauncesDisplayBold,
    color: EDITORIAL.green,
    letterSpacing: -0.6,
  },
});
