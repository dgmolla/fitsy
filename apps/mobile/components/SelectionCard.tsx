import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';

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
        <Ionicons name={icon} size={24} color={selected ? EDITORIAL.cream : EDITORIAL.textSoft} />
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, selected && styles.titleSelected]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, selected && styles.subtitleSelected]}>{subtitle}</Text>
        ) : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={20} color={EDITORIAL.greenAccent} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 12,
    padding: 16,
    marginVertical: 6,
    borderWidth: 2,
    borderColor: EDITORIAL.border,
    gap: 12,
  },
  cardSelected: {
    borderColor: EDITORIAL.greenAccent,
    backgroundColor: EDITORIAL.creamDeep,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: EDITORIAL.creamDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainerSelected: {
    backgroundColor: EDITORIAL.green,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 16,
    color: EDITORIAL.text,
  },
  titleSelected: {
    color: EDITORIAL.green,
  },
  subtitle: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 13,
    color: EDITORIAL.textSoft,
    marginTop: 2,
  },
  subtitleSelected: {
    color: EDITORIAL.greenAccent,
  },
});
