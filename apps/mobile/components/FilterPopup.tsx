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
import { BlurView } from 'expo-blur';
import { useTheme } from '@/lib/theme';
import type { MacroValues } from '@/lib/macroPresets';

interface FilterPopupProps {
  visible: boolean;
  values: MacroValues;
  onApply: (values: MacroValues) => void;
  onClose: () => void;
}

const MACROS: { key: keyof MacroValues; label: string; fullLabel: string; unit: string }[] = [
  { key: 'protein', label: 'P', fullLabel: 'PROT', unit: 'g' },
  { key: 'carbs', label: 'C', fullLabel: 'CARB', unit: 'g' },
  { key: 'fat', label: 'F', fullLabel: 'FAT', unit: 'g' },
];

const CARD_HALF_H = 132;

export function FilterPopup({ visible, values, onApply, onClose }: FilterPopupProps) {
  const { colors } = useTheme();
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

  const translateY = scaleAnim.interpolate({
    inputRange: [0.72, 1],
    outputRange: [-CARD_HALF_H * 0.28, 0],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={visible} transparent animationType="none">
      {/* Heavy blur backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}>
        <BlurView
          tint="dark"
          intensity={80}
          style={StyleSheet.absoluteFill as ViewStyle}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,14,20,0.75)' }]} />
      </Animated.View>

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => dismiss(onClose)}
        accessibilityLabel="Close filters"
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
          {/* Macro boxes */}
          <View style={s.macroRow}>
            {MACROS.map(({ key, fullLabel }) => (
              <View key={key} style={s.macroBox}>
                <TextInput
                  style={s.macroInput}
                  value={draft[key]}
                  onChangeText={(t) => setDraft((p) => ({ ...p, [key]: t }))}
                  keyboardType="numeric"
                  placeholder="—"
                  placeholderTextColor="rgba(241,243,252,0.25)"
                  maxLength={4}
                  textAlign="center"
                  selectionColor="#4ADE80"
                />
                <Text style={s.macroLabel}>{fullLabel}</Text>
              </View>
            ))}
          </View>

          {/* Calories */}
          <View style={s.calBox}>
            <TextInput
              style={s.calInput}
              value={draft.calories}
              onChangeText={(t) => setDraft((p) => ({ ...p, calories: t }))}
              keyboardType="numeric"
              placeholder="—"
              placeholderTextColor="rgba(241,243,252,0.25)"
              maxLength={5}
              textAlign="center"
              selectionColor="#4ADE80"
            />
            <Text style={s.calLabel}>KCAL</Text>
          </View>

          {/* Apply */}
          <Pressable
            style={s.applyButton}
            onPress={() => dismiss(() => onApply(draft))}
          >
            <Text style={s.applyText}>Apply</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    backgroundColor: 'rgba(21,26,33,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(68,72,79,0.25)',
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 20,
    gap: 16,
  },
  title: {
    fontFamily: 'Caslon540Italic',
    fontSize: 26,
    color: '#F1F3FC',
    textAlign: 'center',
    marginBottom: 4,
  },
  /* Macro row */
  macroRow: {
    flexDirection: 'row',
    gap: 10,
  },
  macroBox: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(68,72,79,0.4)',
    paddingVertical: 14,
    gap: 4,
  },
  macroInput: {
    fontSize: 22,
    fontWeight: '400',
    color: '#F1F3FC',
    letterSpacing: -0.3,
    minWidth: 52,
    textAlign: 'center',
    padding: 0,
  },
  macroLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(168,171,179,0.4)',
    letterSpacing: 1.5,
  },
  /* Calories */
  calBox: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(74,222,128,0.5)',
    paddingVertical: 14,
    gap: 4,
  },
  calInput: {
    fontSize: 22,
    fontWeight: '500',
    color: '#4ADE80',
    minWidth: 60,
    textAlign: 'center',
    padding: 0,
  },
  calLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(74,222,128,0.4)',
    letterSpacing: 1.5,
  },
  /* Apply */
  applyButton: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#4ADE80',
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  applyText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0A0E14',
    letterSpacing: -0.2,
  },
});
