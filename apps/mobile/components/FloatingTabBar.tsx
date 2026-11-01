import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Animated, { ReduceMotion, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, EDITORIAL, RADII } from '@/lib/brand';
import { FLOATING_TAB_BAR_GAP, FLOATING_TAB_BAR_HEIGHT } from '@/lib/floatingNav';

function ActiveTab({ focused }: { focused: boolean }) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(focused ? 1 : 0, { duration: 160, reduceMotion: ReduceMotion.System }),
  }), [focused]);
  return <Animated.View style={[styles.active, style]} />;
}

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View testID="floating-tab-bar-position" pointerEvents="box-none" style={[styles.position, { bottom: insets.bottom + FLOATING_TAB_BAR_GAP }]}>
      <View style={styles.shadow}>
        <View testID="floating-tab-bar" style={styles.capsule}>
          {/* The native blur is decoration; only the foreground tabs own touches. */}
          <BlurView pointerEvents="none" tint="light" intensity={60}
            experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const focused = state.index === index;
            const color = focused ? EDITORIAL.green : EDITORIAL.textSoft;
            return (
              <Pressable key={route.key} testID={options.tabBarButtonTestID}
                accessibilityRole="tab" accessibilityLabel={options.tabBarAccessibilityLabel ?? options.title ?? route.name}
                accessibilityState={{ selected: focused }}
                style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
                }}
                onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}>
                <View pointerEvents="none" style={styles.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <ActiveTab focused={focused} />
                  {options.tabBarIcon?.({ focused, color, size: 24 })}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 1 },
  shadow: { borderRadius: RADII.pill, shadowColor: EDITORIAL.green,
    shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  capsule: { height: FLOATING_TAB_BAR_HEIGHT, flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 7,
    borderRadius: RADII.pill, overflow: 'hidden', borderWidth: 1, borderColor: `${COLORS.white}B3`,
    backgroundColor: `${EDITORIAL.cream}99` },
  tab: { width: 64, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADII.pill },
  pressed: { opacity: 0.65 },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  active: { ...StyleSheet.absoluteFillObject, borderRadius: RADII.pill, backgroundColor: EDITORIAL.greenAccentTint },
});
