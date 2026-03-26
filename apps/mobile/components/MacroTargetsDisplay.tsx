import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { MacroValues } from '@/lib/macroPresets';

const FIELDS: { key: keyof MacroValues; label: string }[] = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
  { key: 'calories', label: 'Calories' },
];

export interface MacroTargetsDisplayProps {
  targets: MacroValues;
  onEditPress: () => void;
  onSetupPress: () => void;
}

export function MacroTargetsDisplay({ targets, onEditPress, onSetupPress }: MacroTargetsDisplayProps) {
  const hasData = FIELDS.some(({ key }) => targets[key] !== '');

  if (!hasData) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Macro Targets</Text>
        <Text style={styles.emptyText}>No macro targets set yet.</Text>
        <Pressable
          style={styles.ctaButton}
          onPress={onSetupPress}
          accessibilityRole="button"
          accessibilityLabel="Set up macro targets"
        >
          <Text style={styles.ctaButtonText}>Set up macro targets</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Macro Targets</Text>
        <TouchableOpacity
          onPress={onEditPress}
          accessibilityRole="button"
          accessibilityLabel="Edit macro targets"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.editLink}>Edit</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.macroGrid}>
        {FIELDS.map(({ key, label }) => (
          <View key={key} style={styles.macroCard}>
            <Text style={styles.macroValue}>{targets[key] || '—'}</Text>
            <Text style={styles.macroLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  macroGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  macroCard: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  macroValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D7D46',
  },
  macroLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    textAlign: 'center',
  },
  editLink: {
    fontSize: 14,
    color: '#2D7D46',
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 12,
  },
  ctaButton: {
    height: 44,
    backgroundColor: '#2D7D46',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
