import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface Props {
  isSaved: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}

export function BookmarkButton({ isSaved, onPress, accessibilityLabel }: Props) {
  const handlePress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (isSaved ? 'Remove bookmark' : 'Bookmark item')}
      accessibilityState={{ selected: isSaved }}
    >
      <Ionicons
        name={isSaved ? 'bookmark' : 'bookmark-outline'}
        size={22}
        color={isSaved ? '#2D7D46' : '#6B7280'}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 4,
    borderRadius: 6,
  },
  pressed: {
    opacity: 0.6,
  },
});
