import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, TEXT } from '@/lib/brand';

export function DiscoveryViewToggle({ map, onPress }: { map: boolean; onPress: () => void }) {
  return <Pressable testID="discovery-view-toggle" onPress={onPress} style={s.button}
    accessibilityRole="button" accessibilityLabel={map ? 'Show restaurant list' : 'Show restaurant map'}>
    <Ionicons name={map ? 'list' : 'map-outline'} size={18} color={EDITORIAL.green} />
    <Text style={s.label}>{map ? 'List' : 'Map'}</Text>
  </Pressable>;
}

const s = StyleSheet.create({
  button: { minHeight: 44, paddingHorizontal: 15, borderRadius: 24, backgroundColor: EDITORIAL.cream,
    borderWidth: 1, borderColor: EDITORIAL.creamDeep, flexDirection: 'row', gap: 7, alignItems: 'center', alignSelf: 'flex-end' },
  label: { ...TEXT.bodySmall, color: EDITORIAL.green },
});
