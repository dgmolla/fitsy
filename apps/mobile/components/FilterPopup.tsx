import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Alert,
  Easing,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import { EDITORIAL } from "@/lib/brand";
import { filterPopupStyles as s } from "./FilterPopup.styles";
import { StepperControl } from "@/components/StepperControl";
import { MACRO_COLORS } from "@/lib/macroColors";
import type { MacroValues } from "@/lib/macroPresets";
import { isCompleteTarget, normalizeCompleteTarget, parseTarget, settleTargetEdit } from "@/lib/macroEnergy";
interface FilterPopupProps {
  visible: boolean;
  values: MacroValues;
  onApply: (values: MacroValues, mode?: "search" | "complete") => void | Promise<void>;
  onClose: () => void | Promise<void>;
  mode?: "search" | "complete";
  allowPartial?: boolean;
  goal?: "build_muscle" | "lose_fat" | "maintain" | "performance";
}
const MACROS: {
  key: keyof MacroValues;
  label: string;
  color: string;
  step: number;
}[] = [
  { key: "calories", label: "Calories", color: EDITORIAL.green, step: 50 },
  { key: "protein", label: "Protein", color: MACRO_COLORS.protein, step: 5 },
  { key: "carbs", label: "Carbs", color: MACRO_COLORS.carbs, step: 5 },
  { key: "fat", label: "Fat", color: MACRO_COLORS.fat, step: 5 },
];
export function FilterPopup({
  visible,
  values,
  onApply,
  onClose,
  mode = "search",
  allowPartial = false,
  goal = "maintain",
}: FilterPopupProps) {
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<MacroValues>(values);
  const [linked, setLinked] = useState(mode === "complete");
  const linkedRef = useRef(mode === "complete");
  const hadAllocation = useRef(isCompleteTarget(values));
  const caloriesEdited = useRef(values.calories !== '');
  const draftRef = useRef(values);
  const lastEdited = useRef<keyof MacroValues>("calories");
  const latestValues = useRef(values);
  latestValues.current = values;
  const wasVisible = useRef(false);
  function replaceDraft(next: MacroValues) {
    hadAllocation.current ||= isCompleteTarget(next);
    draftRef.current = next;
    setDraft(next);
  }
  const scaleAnim = useRef(new Animated.Value(0.72)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const blurOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible && !wasVisible.current) {
      draftRef.current = latestValues.current;
      setDraft(latestValues.current);
      linkedRef.current = mode === "complete";
      hadAllocation.current = isCompleteTarget(latestValues.current);
      caloriesEdited.current = latestValues.current.calories !== '';
      setLinked(linkedRef.current);
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
    wasVisible.current = visible;
  }, [visible, mode, scaleAnim, opacityAnim, blurOpacity]);
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
    if (key === "calories") caloriesEdited.current = true;
    lastEdited.current = key;
    replaceDraft({ ...draftRef.current, [key]: val });
  }
  const partialDraft = (values: MacroValues) => allowPartial && (!isCompleteTarget(values)
    || parseTarget(values.calories) === null
    || (!linkedRef.current && [values.protein, values.carbs, values.fat].some(value => parseTarget(value) === 0)));
  const clearedProfileMacro = (values: MacroValues) => !allowPartial && linkedRef.current
    && ((caloriesEdited.current && !parseTarget(values.calories))
      || (hadAllocation.current && !isCompleteTarget(values)));
  function settle(key: keyof MacroValues) {
    if (linkedRef.current && !partialDraft(draftRef.current) && !clearedProfileMacro(draftRef.current))
      replaceDraft(settleTargetEdit(draftRef.current, key, goal, true, !caloriesEdited.current));
  }
  function step(
    key: keyof MacroValues,
    delta: number,
  ) {
    const current = parseInt(draftRef.current[key], 10) || 0;
    const macro = MACROS.find((m) => m.key === key)!;
    lastEdited.current = key;
    if (key === "calories") caloriesEdited.current = true;
    const next = { ...draftRef.current, [key]: String(Math.max(0, current + delta * macro.step)) };
    replaceDraft(linkedRef.current && !partialDraft(next) && !clearedProfileMacro(next)
      ? settleTargetEdit(next, key, goal, true, !caloriesEdited.current) : next);
  }
  const translateY = scaleAnim.interpolate({
    inputRange: [0.72, 1],
    outputRange: [-40, 0],
    extrapolate: "clamp",
  });
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => dismiss(onClose)}>
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
        testID="meal-filter-close"
        accessibilityRole="button"
      />

      <KeyboardAvoidingView style={s.overlay} pointerEvents="box-none" behavior={Platform.OS === "ios" ? "padding" : "height"}>
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
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>

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
                  fieldLabel={key === "calories" ? "Calories per meal" : `${label} grams`}
                  value={draft[key]}
                  unit={key === "calories" ? undefined : "g"}
                  onChangeText={(t) => update(key, t)}
                  onBlur={() => settle(key)}
                  onStep={(dir) => step(key, dir)}
                />
              </View>
            </View>
          ))}
          </ScrollView>
          {mode === "search" && !linked && isCompleteTarget(draft)
            && parseTarget(draft.calories) !== null && Number(draft.calories) > 0
            && [draft.protein, draft.carbs, draft.fat].every(value => (parseTarget(value) ?? 0) > 0) && (
              <Pressable accessibilityRole="button" accessibilityLabel="Link calories and macros"
                testID="meal-filter-link" onPress={() => {
                  replaceDraft(settleTargetEdit(draftRef.current, 'calories', goal, true));
                  linkedRef.current = true;
                  setLinked(true);
                }}>
                <Text style={s.linkText}>Link calories and macros</Text>
              </Pressable>
            )}
          {allowPartial && linked && (
            <Pressable accessibilityRole="button" accessibilityLabel="Use independent filters"
              testID="meal-filter-unlink" onPress={() => {
                linkedRef.current = false;
                setLinked(false);
              }}>
              <Text style={s.linkText}>Use independent filters</Text>
            </Pressable>
          )}
          {/* Apply */}
          <Pressable
            style={s.applyBtn}
            accessibilityRole="button"
            accessibilityLabel="Apply meal targets"
            testID="meal-filter-apply"
            disabled={saving}
            onPress={async () => {
              if (saving) return;
              if (clearedProfileMacro(draftRef.current)) {
                Alert.alert("Complete your target", "Enter valid calories and all three macros before applying.");
                return;
              }
              const independent = !linkedRef.current || partialDraft(draftRef.current);
              const settled = independent ? draftRef.current : settleTargetEdit(draftRef.current, lastEdited.current, goal, true, !caloriesEdited.current);
              if (!independent && (!isCompleteTarget(settled) || !parseTarget(settled.calories))) {
                Alert.alert("Complete your target", "Enter valid calories and all three macros before applying.");
                return;
              }
              setSaving(true);
              try {
                await onApply(independent ? settled : normalizeCompleteTarget(settled), independent ? "search" : "complete");
                dismiss(() => {});
              } catch {
                Alert.alert("Couldn't save targets", "Your edits are still here. Please try again.");
              } finally { setSaving(false); }
            }}
          >
            <Text style={s.applyText}>{saving ? "Saving..." : "Apply"}</Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
