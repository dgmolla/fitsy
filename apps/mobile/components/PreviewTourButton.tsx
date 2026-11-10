import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL } from '@/lib/brand';
import { s } from './DiscoveryScreen.styles';

// The help slot keeps its width while results load, so the guide copy never
// re-wraps and the search field below it does not jump under a tap.
export function PreviewTourButton({ ready, onPress }: { ready: boolean; onPress: () => void }) {
  if (!ready) return <View style={s.previewTourButton} testID="preview-show-tour-slot" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
  return <Pressable onPress={onPress} style={s.previewTourButton} accessibilityRole="button" accessibilityLabel="Show me how Fitsy works" accessibilityHint="Replay the five preview tips" testID="preview-show-tour">
    <Ionicons name="help-circle-outline" size={20} color={EDITORIAL.green} />
  </Pressable>;
}
