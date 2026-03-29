import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/lib/theme';
import type { MacroValues } from '@/lib/macroPresets';
import { BlurFallback } from '@/lib/BlurFallback';

interface FilterPopupProps {
  visible: boolean;
  values: MacroValues;
  onApply: (values: MacroValues) => void;
  onClose: () => void;
}

const MACROS: { key: keyof MacroValues; label: string; unit: string; color: string }[] = [
  { key: 'protein', label: 'P', unit: 'g', color: '#3B82F6' },
  { key: 'carbs', label: 'C', unit: 'g', color: '#F59E0B' },
  { key: 'fat', label: 'F', unit: 'g', color: '#EF4444' },
];

// Approximate half-height of card for top-anchored transform
const CARD_HALF_H = 132;

export function FilterPopup({ visible, values, onApply, onClose }: FilterPopupProps) {
  const { colors, mode } = useTheme();
  const [draft, setDraft] = useState<MacroValues>(values);

  const scaleAnim = useRef(new Animated.Value(0.72)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const blurOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setDraft(values);
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
  }, [visible, values, scaleAnim, opacityAnim, blurOpacity]);

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

  // translateY compensates for center-origin scaling to pin the card top
  // formula: -CARD_HALF_H * (1 - scale)
  const translateY = scaleAnim.interpolate({
    inputRange: [0.72, 1],
    outputRange: [-CARD_HALF_H * 0.28, 0],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={visible} transparent animationType="none">
      {/* Gaussian blur backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}>
        <BlurFallback
          tint={mode === 'dark' ? 'dark' : 'light'}
          intensity={120}
          fallbackColor={mode === 'dark' ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0.55)'}
          style={StyleSheet.absoluteFill as ViewStyle}
        />
      </Animated.View>

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => dismiss(onClose)}
        accessibilityLabel="Close filters"
        accessibilityRole="button"
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.bgCard,
              borderColor: colors.border,
              shadowColor: colors.glassShadowColor,
              shadowOpacity: colors.glassShadowOpacity,
              shadowRadius: colors.glassShadowRadius,
              shadowOffset: { width: 0, height: 16 },
              elevation: 28,
              opacity: opacityAnim,
              transform: [{ scale: scaleAnim }, { translateY }],
            },
          ]}
        >
          {/* Macro row: P · C · F */}
          <View style={styles.macroRow}>
            {MACROS.map(({ key, label, unit, color }) => (
              <View
                key={key}
                style={[
                  styles.macroBox,
                  {
                    backgroundColor: colors.inputBg,
                    borderColor: colors.inputBorder,
                  },
                ]}
              >
                <Text style={[styles.macroLabel, { color }]}>{label}</Text>
                <TextInput
                  style={[styles.macroInput, { color: colors.textPrimary }]}
                  value={draft[key]}
                  onChangeText={(t) => setDraft((p) => ({ ...p, [key]: t }))}
                  keyboardType="numeric"
                  placeholder="—"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={4}
                  textAlign="center"
                  selectionColor={color}
                />
                <Text style={[styles.macroUnit, { color: colors.textTertiary }]}>{unit}</Text>
              </View>
            ))}
          </View>

          {/* Calories */}
          <View
            style={[
              styles.calRow,
              {
                backgroundColor: colors.inputBg,
                borderColor: colors.inputBorder,
              },
            ]}
          >
            <Text style={[styles.calLabel, { color: colors.textSecondary }]}>Calories</Text>
            <View style={styles.calRight}>
              <TextInput
                style={[styles.calInput, { color: colors.textPrimary }]}
                value={draft.calories}
                onChangeText={(t) => setDraft((p) => ({ ...p, calories: t }))}
                keyboardType="numeric"
                placeholder="—"
                placeholderTextColor={colors.textTertiary}
                maxLength={5}
              />
              <Text style={[styles.calUnit, { color: colors.textTertiary }]}>kcal</Text>
            </View>
          </View>

          {/* Divider */}
          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

          {/* Apply */}
          <Pressable
            style={[styles.applyButton, { backgroundColor: colors.accent }]}
            onPress={() => dismiss(() => onApply(draft))}
          >
            <Text style={[styles.applyText, { color: colors.accentOnAccent }]}>Apply</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 100,
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 10,
  },
  macroRow: {
    flexDirection: 'row',
    gap: 9,
  },
  macroBox: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    paddingTop: 12,
    paddingBottom: 10,
    alignItems: 'center',
    gap: 2,
  },
  macroLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  macroInput: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -1.5,
    minWidth: 52,
    textAlign: 'center',
    padding: 0,
    lineHeight: 34,
  },
  macroUnit: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  calRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  calLabel: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  calRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  calInput: {
    fontSize: 18,
    fontWeight: '700',
    minWidth: 52,
    textAlign: 'right',
    padding: 0,
    letterSpacing: -0.5,
  },
  calUnit: {
    fontSize: 12,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    borderRadius: 1,
    marginHorizontal: 2,
    marginTop: 2,
  },
  applyButton: {
    borderRadius: 15,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: '#2D7D46',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 6,
  },
  applyText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
