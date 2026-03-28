import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  icon: IoniconsName;
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}

export function SelectionCard({ icon, title, subtitle, selected, onPress }: Props) {
  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
    >
      <View style={[styles.iconContainer, selected && styles.iconContainerSelected]}>
        <Ionicons name={icon} size={24} color={selected ? '#FFFFFF' : '#6B7280'} />
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, selected && styles.titleSelected]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, selected && styles.subtitleSelected]}>{subtitle}</Text>
        ) : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={20} color="#2D7D46" />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginVertical: 6,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    gap: 12,
  },
  cardSelected: {
    borderColor: '#2D7D46',
    backgroundColor: '#F0FDF4',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainerSelected: {
    backgroundColor: '#2D7D46',
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  titleSelected: {
    color: '#1A5C32',
  },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  subtitleSelected: {
    color: '#4B7C5A',
  },
});
