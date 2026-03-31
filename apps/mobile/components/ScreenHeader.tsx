import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function ScreenHeader() {
  return (
    <View style={styles.container}>
      <View style={styles.logoRow}>
        <Ionicons name="restaurant" size={18} color="#4ADE80" />
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
    color: '#4ADE80',
    letterSpacing: -0.8,
  },
});
