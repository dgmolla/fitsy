import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ConfidenceLevel } from '@fitsy/shared';

interface Props {
  confidence: ConfidenceLevel;
}

const CONF: Record<ConfidenceLevel, { text: string; dot: string; bg: string; border: string }> = {
  HIGH:   { text: '#4ADE80', dot: '#4ADE80', bg: 'rgba(74,222,128,0.10)',  border: 'rgba(74,222,128,0.22)' },
  MEDIUM: { text: '#F59E0B', dot: '#F59E0B', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.22)' },
  LOW:    { text: '#A8ABB3', dot: '#4A5260', bg: 'rgba(74,82,96,0.12)',    border: 'rgba(74,82,96,0.2)' },
};

const LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'High',
  MEDIUM: 'Med',
  LOW: 'Low',
};

export function ConfidenceBadge({ confidence }: Props) {
  const c = CONF[confidence];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg, borderColor: c.border }]}>
      <View style={[styles.dot, { backgroundColor: c.dot }]} />
      <Text style={[styles.text, { color: c.text }]}>{LABEL[confidence]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
