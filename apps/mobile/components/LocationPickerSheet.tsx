import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { PRESET_LOCATIONS, type PresetLocation } from '@/lib/locations';

/**
 * LocationPickerSheet — bottom sheet that lets the user manually pick an
 * LA neighborhood (S-227). Pairs with the truthful fallback labels (S-224)
 * to form the deny-path escape hatch.
 *
 * Visual style mirrors `ProfileEditSheet` (centered card on blurred
 * backdrop) for consistency. We deliberately don't slide-from-bottom —
 * the existing design system uses a centered card pattern everywhere.
 */

interface LocationPickerSheetProps {
  visible: boolean;
  /** Currently active neighborhood name when in manual mode; undefined otherwise. */
  activeName?: string;
  /** Called when the user picks a preset. */
  onPick: (loc: PresetLocation) => void;
  /** Called when the user taps "Use my current location". */
  onUseCurrent: () => void;
  onClose: () => void;
}

export function LocationPickerSheet({
  visible,
  activeName,
  onPick,
  onUseCurrent,
  onClose,
}: LocationPickerSheetProps) {
  const scaleAnim = useRef(new Animated.Value(0.72)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const blurOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0.72);
      opacityAnim.setValue(0);
      blurOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          damping: 14,
          stiffness: 340,
          mass: 0.72,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 160,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(blurOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, scaleAnim, opacityAnim, blurOpacity]);

  function dismiss(cb: () => void) {
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.88,
        duration: 130,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 130,
        useNativeDriver: true,
      }),
      Animated.timing(blurOpacity, {
        toValue: 0,
        duration: 130,
        useNativeDriver: true,
      }),
    ]).start(() => cb());
  }

  const translateY = scaleAnim.interpolate({
    inputRange: [0.72, 1],
    outputRange: [-40, 0],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={visible} transparent animationType="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}>
        <BlurView tint="light" intensity={60} style={StyleSheet.absoluteFill as ViewStyle} />
        <View style={[StyleSheet.absoluteFill, s.dim]} />
      </Animated.View>

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => dismiss(onClose)}
        accessibilityLabel="Close location picker"
        accessibilityRole="button"
      />

      <View style={s.overlay} pointerEvents="box-none">
        <Animated.View
          style={[
            s.card,
            {
              opacity: opacityAnim,
              transform: [{ scale: scaleAnim }, { translateY }],
            },
          ]}
        >
          <Text style={s.title}>Choose a neighborhood</Text>
          <Text style={s.subtitle}>
            Pick where you want to search. Your choice sticks until you change it.
          </Text>

          {/* Use my current location row — always at the top so users in GPS
              mode never have to scroll past the preset list to revert. */}
          <Pressable
            style={s.currentRow}
            onPress={() => dismiss(onUseCurrent)}
            accessibilityLabel="Use my current location"
            accessibilityRole="button"
          >
            <Ionicons name="locate" size={18} color={EDITORIAL.greenAccent} />
            <Text style={s.currentLabel}>Use my current location</Text>
          </Pressable>

          <View style={s.divider} />

          <ScrollView
            style={s.list}
            contentContainerStyle={s.listContent}
            showsVerticalScrollIndicator={false}
          >
            {PRESET_LOCATIONS.map((loc) => {
              const active = activeName === loc.name;
              return (
                <Pressable
                  key={loc.name}
                  style={[s.row, active && s.rowActive]}
                  onPress={() => dismiss(() => onPick(loc))}
                  accessibilityLabel={`Search near ${loc.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[s.rowLabel, active && s.rowLabelActive]}>
                    {loc.name}
                  </Text>
                  {active && (
                    <Ionicons name="checkmark" size={18} color={EDITORIAL.cream} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  dim: { backgroundColor: 'rgba(0,0,0,0.3)' },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '78%',
    borderRadius: 28,
    backgroundColor: EDITORIAL.cream,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 10,
  },
  title: {
    fontFamily: FONTS.frauncesBold,
    fontSize: 22,
    color: EDITORIAL.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: EDITORIAL.textSoft,
    marginTop: 4,
    marginBottom: 16,
    lineHeight: 18,
  },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: EDITORIAL.creamCard,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
  },
  currentLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: EDITORIAL.greenAccent,
    letterSpacing: -0.2,
  },
  divider: {
    height: 1,
    backgroundColor: EDITORIAL.border,
    marginVertical: 14,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 6,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: EDITORIAL.creamCard,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
  },
  rowActive: {
    backgroundColor: EDITORIAL.green,
    borderColor: EDITORIAL.green,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: EDITORIAL.text,
    letterSpacing: -0.2,
  },
  rowLabelActive: {
    color: EDITORIAL.cream,
  },
});
