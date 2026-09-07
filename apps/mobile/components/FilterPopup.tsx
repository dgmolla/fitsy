import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import { EDITORIAL, FONTS } from "@/lib/brand";
import { StepperControl } from "@/components/StepperControl";
import { MACRO_COLORS } from "@/lib/macroColors";
import type { MacroValues } from "@/lib/macroPresets";

interface FilterPopupProps {
  visible: boolean;
  values: MacroValues;
  onApply: (values: MacroValues) => void;
  onClose: () => void;
}

const MACROS: {
  key: keyof Pick<MacroValues, "protein" | "carbs" | "fat">;
  label: string;
  color: string;
  step: number;
}[] = [
  { key: "protein", label: "Protein", color: MACRO_COLORS.protein, step: 5 },
  { key: "carbs", label: "Carbs", color: MACRO_COLORS.carbs, step: 5 },
  { key: "fat", label: "Fat", color: MACRO_COLORS.fat, step: 5 },
];

function calcCal(p: string, c: string, f: string): string {
  const pn = parseFloat(p) || 0;
  const cn = parseFloat(c) || 0;
  const fn = parseFloat(f) || 0;
  const total = pn * 4 + cn * 4 + fn * 9;
  return total > 0 ? String(Math.round(total)) : "";
}

export function FilterPopup({
  visible,
  values,
  onApply,
  onClose,
}: FilterPopupProps) {
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

  function step(
    key: keyof Pick<MacroValues, "protein" | "carbs" | "fat">,
    delta: number,
  ) {
    setDraft((prev) => {
      const current = parseInt(prev[key], 10) || 0;
      const macro = MACROS.find((m) => m.key === key)!;
      const next = {
        ...prev,
        [key]: String(Math.max(0, current + delta * macro.step)),
      };
      next.calories = calcCal(next.protein, next.carbs, next.fat);
      return next;
    });
  }

  const translateY = scaleAnim.interpolate({
    inputRange: [0.72, 1],
    outputRange: [-40, 0],
    extrapolate: "clamp",
  });

  const cal = calcCal(draft.protein, draft.carbs, draft.fat);

  return (
    <Modal visible={visible} transparent animationType="none">
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}
      >
        <BlurView
          tint="light"
          intensity={60}
          style={StyleSheet.absoluteFill as ViewStyle}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "rgba(0,0,0,0.3)" },
          ]}
        />
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
          <Text style={s.title}>Per-meal targets</Text>

          {MACROS.map(({ key, label, color }, i) => (
            <View key={key}>
              {i > 0 && <View style={s.divider} />}
              <View style={s.row}>
                <View style={s.labelCol}>
                  <View style={[s.dot, { backgroundColor: color }]} />
                  <Text style={s.label}>{label}</Text>
                </View>

                <StepperControl
                  label={label}
                  fieldLabel={`${label} grams`}
                  value={draft[key]}
                  unit="g"
                  onChangeText={(t) => update(key, t)}
                  onStep={(dir) => step(key, dir)}
                />
              </View>
            </View>
          ))}

          {/* Per-meal total */}
          <View style={s.calRow}>
            <Text style={s.calLabel}>Per meal</Text>
            <View style={s.calValue}>
              <Text style={s.calNum}>{cal || "—"}</Text>
              <Text style={s.calUnit}>kcal</Text>
            </View>
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
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  // Mirrors the "Tweak macros" tile on fitsy.org (apps/api landing
  // MacroDemo): cream card, serif title, right-aligned stepper cluster,
  // serif figures, per-meal total row, full-width dark Apply.
  card: {
    width: "100%",
    maxWidth: 356,
    borderRadius: 24,
    backgroundColor: EDITORIAL.cream,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 10,
  },

  title: {
    fontFamily: FONTS.frauncesMedium,
    fontSize: 20,
    color: EDITORIAL.green,
    letterSpacing: -0.3,
    marginBottom: 10,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
  },
  labelCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  label: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 15,
    fontWeight: "600",
    color: EDITORIAL.textMid,
    letterSpacing: -0.2,
  },

  divider: {
    height: 1,
    backgroundColor: EDITORIAL.border,
  },

  calRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: 22,
    paddingBottom: 18,
  },
  calLabel: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 13,
    fontWeight: "600",
    color: EDITORIAL.textSoft,
  },
  calValue: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
  },
  calNum: {
    fontFamily: FONTS.frauncesMedium,
    fontSize: 40,
    color: EDITORIAL.green,
    letterSpacing: -1.2,
  },
  calUnit: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 14,
    fontWeight: "600",
    color: EDITORIAL.textSoft,
  },

  applyBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: EDITORIAL.green,
  },
  applyText: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 15,
    fontWeight: "700",
    color: EDITORIAL.cream,
    letterSpacing: -0.2,
  },
});
