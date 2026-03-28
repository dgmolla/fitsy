import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
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
  { key: 'protein', label: 'Protein', unit: 'g', color: '#3B82F6' },
  { key: 'carbs', label: 'Carbs', unit: 'g', color: '#F59E0B' },
  { key: 'fat', label: 'Fat', unit: 'g', color: '#EF4444' },
];

export function FilterPopup({ visible, values, onApply, onClose }: FilterPopupProps) {
  const { colors, mode } = useTheme();
  const [draft, setDraft] = useState<MacroValues>(values);

  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setDraft(values);
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          damping: 18,
          stiffness: 280,
          mass: 0.8,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, values, scaleAnim, opacityAnim]);

  function handleClose() {
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }

  function handleApply() {
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start(() => onApply(draft));
  }

  return (
    <Modal visible={visible} transparent animationType="none">
      <View style={styles.overlay}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: opacityAnim }]}>
          <BlurFallback
            tint={mode === 'dark' ? 'dark' : 'light'}
            intensity={100}
            fallbackColor="rgba(0,0,0,0.6)"
            style={StyleSheet.absoluteFill as ViewStyle}
          />
        </Animated.View>

        <Pressable style={styles.backdrop} onPress={handleClose} />

        <Animated.View style={[styles.card, {
          backgroundColor: colors.bgCard,
          borderColor: colors.border,
          shadowColor: colors.glassShadowColor,
          shadowOpacity: colors.glassShadowOpacity,
          shadowRadius: colors.glassShadowRadius,
          shadowOffset: { width: 0, height: 12 },
          elevation: 24,
          opacity: opacityAnim,
          transform: [
            { scale: scaleAnim },
            // Start from slightly above (where the chips are)
            { translateY: scaleAnim.interpolate({
              inputRange: [0.85, 1],
              outputRange: [-30, 0],
            })},
          ],
        }]}>
          {/* Three macro inputs in a row */}
          <View style={styles.macroRow}>
            {MACROS.map(({ key, label, unit, color }) => (
              <View
                key={key}
                style={[styles.macroBox, {
                  backgroundColor: colors.inputBg,
                  borderColor: colors.inputBorder,
                }]}
              >
                <View style={[styles.macroColorBar, { backgroundColor: color }]} />
                <TextInput
                  style={[styles.macroInput, { color: colors.textPrimary }]}
                  value={draft[key]}
                  onChangeText={(t) => setDraft((p) => ({ ...p, [key]: t }))}
                  keyboardType="numeric"
                  placeholder={'\u2014'}
                  placeholderTextColor={colors.textTertiary}
                  maxLength={4}
                  textAlign="center"
                />
                <Text style={[styles.macroUnit, { color: colors.textTertiary }]}>
                  {label} ({unit})
                </Text>
              </View>
            ))}
          </View>

          {/* Calories row */}
          <View style={[styles.calRow, {
            backgroundColor: colors.inputBg,
            borderColor: colors.inputBorder,
          }]}>
            <Text style={[styles.calLabel, { color: colors.textSecondary }]}>Calories</Text>
            <View style={styles.calRight}>
              <TextInput
                style={[styles.calInput, { color: colors.textPrimary }]}
                value={draft.calories}
                onChangeText={(t) => setDraft((p) => ({ ...p, calories: t }))}
                keyboardType="numeric"
                placeholder={'\u2014'}
                placeholderTextColor={colors.textTertiary}
                maxLength={5}
              />
              <Text style={[styles.calUnit, { color: colors.textTertiary }]}>kcal</Text>
            </View>
          </View>

          {/* Apply */}
          <Pressable
            style={[styles.applyButton, { backgroundColor: colors.accent }]}
            onPress={handleApply}
          >
            <Text style={[styles.applyText, { color: colors.accentOnAccent }]}>
              Apply
            </Text>
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
    paddingTop: 120,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: '90%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 18,
    paddingTop: 18,
  },
  macroRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  macroBox: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 5,
    overflow: 'hidden',
  },
  macroColorBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  macroInput: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -1,
    minWidth: 56,
    textAlign: 'center',
    padding: 0,
  },
  macroUnit: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  calRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 14,
  },
  calLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  calRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  calInput: {
    fontSize: 18,
    fontWeight: '700',
    minWidth: 50,
    textAlign: 'right',
    padding: 0,
    letterSpacing: -0.5,
  },
  calUnit: {
    fontSize: 12,
    fontWeight: '500',
  },
  applyButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#2D7D46',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  applyText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
