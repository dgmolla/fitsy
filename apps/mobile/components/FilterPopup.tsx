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
import { COLORS, FONTS } from '@/lib/brand';
import type { MacroValues } from '@/lib/macroPresets';

interface FilterPopupProps {
  visible: boolean;
  values: MacroValues;
  onApply: (values: MacroValues) => void;
  onClose: () => void;
}

const MACROS: {
  key: keyof Pick<MacroValues, 'protein' | 'carbs' | 'fat'>;
  label: string;
  color: string;
  step: number;
}[] = [
  { key: 'protein', label: 'Protein', color: '#5B7C6B', step: 5 },
  { key: 'carbs', label: 'Carbs', color: '#8B7355', step: 5 },
  { key: 'fat', label: 'Fat', color: '#7B6B8A', step: 5 },
];

function calcCal(p: string, c: string, f: string): string {
  const pn = parseFloat(p) || 0;
  const cn = parseFloat(c) || 0;
  const fn = parseFloat(f) || 0;
  const total = pn * 4 + cn * 4 + fn * 9;
  return total > 0 ? String(Math.round(total)) : '';
}

export function FilterPopup({ visible, values, onApply, onClose }: FilterPopupProps) {
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

  function update(key: keyof MacroValues, val: string) {
    setDraft((prev) => {
      const next = { ...prev, [key]: val };
      next.calories = calcCal(next.protein, next.carbs, next.fat);
      return next;
    });
  }

  function step(key: keyof Pick<MacroValues, 'protein' | 'carbs' | 'fat'>, delta: number) {
    setDraft((prev) => {
      const current = parseInt(prev[key], 10) || 0;
      const macro = MACROS.find((m) => m.key === key)!;
      const next = { ...prev, [key]: String(Math.max(0, current + delta * macro.step)) };
      next.calories = calcCal(next.protein, next.carbs, next.fat);
      return next;
    });
  }

  const translateY = scaleAnim.interpolate({
    inputRange: [0.72, 1],
    outputRange: [-40, 0],
    extrapolate: 'clamp',
  });

  const cal = calcCal(draft.protein, draft.carbs, draft.fat);

  return (
    <Modal visible={visible} transparent animationType="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}>
        <BlurView
          tint="light"
          intensity={60}
          style={StyleSheet.absoluteFill as ViewStyle}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
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
          {MACROS.map(({ key, label, color }, i) => (
            <View key={key}>
              {i > 0 && <View style={s.divider} />}
              <View style={s.row}>
                <View style={s.labelCol}>
                  <View style={[s.dot, { backgroundColor: color }]} />
                  <Text style={s.label}>{label}</Text>
                </View>

                <Pressable style={s.stepper} onPress={() => step(key, -1)}>
                  <Text style={s.stepperText}>−</Text>
                </Pressable>

                <TextInput
                  style={s.numInput}
                  value={draft[key]}
                  onChangeText={(t) => update(key, t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="—"
                  placeholderTextColor="#C8C8C8"
                  maxLength={4}
                  textAlign="center"
                  selectTextOnFocus
                />
                <Text style={s.unit}>g</Text>

                <Pressable style={s.stepper} onPress={() => step(key, 1)}>
                  <Text style={s.stepperText}>+</Text>
                </Pressable>
              </View>
            </View>
          ))}

          {/* Calories */}
          <View style={s.calRow}>
            <Text style={s.calNum}>{cal || '—'}</Text>
            <Text style={s.calUnit}>kcal</Text>
          </View>

          {/* Apply */}
          <Pressable
            style={s.applyBtn}
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
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 28,
    backgroundColor: '#FDFBF7',
    borderWidth: 1,
    borderColor: '#E8E2D8',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 10,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
  },
  labelCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: 95,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 15,
    fontWeight: '600',
    color: '#1B3A26',
    letterSpacing: -0.3,
  },

  stepper: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0EBE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 20,
    fontWeight: '300',
    color: '#3A4F41',
    marginTop: -1,
  },

  numInput: {
    fontFamily: FONTS.nunitoSansSemiBold,
    flex: 1,
    fontSize: 34,
    fontWeight: '700',
    color: '#1B3A26',
    letterSpacing: -1.5,
    padding: 0,
    marginHorizontal: 4,
  },
  unit: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8C7E',
    marginRight: 8,
  },

  divider: {
    height: 1,
    backgroundColor: '#E8E2D8',
  },

  calRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 20,
    paddingBottom: 16,
  },
  calNum: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 40,
    fontWeight: '800',
    color: '#1B3A26',
    letterSpacing: -2,
  },
  calUnit: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 15,
    fontWeight: '600',
    color: '#7A8C7E',
    letterSpacing: 0.3,
  },

  applyBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#1B3A26',
  },
  applyText: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 16,
    fontWeight: '700',
    color: '#FDFBF7',
    letterSpacing: -0.2,
  },
});
