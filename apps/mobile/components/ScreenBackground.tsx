import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

interface Props {
  children: React.ReactNode;
}

/**
 * Full-screen background with a subtle radial-like gradient.
 * Uses a diagonal gradient from top-left to bottom-right
 * to simulate a soft light source hitting the corner.
 */
export function ScreenBackground({ children }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.content, { paddingTop: insets.top }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
});
