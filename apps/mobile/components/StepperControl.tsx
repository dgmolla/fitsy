import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { EDITORIAL, FONTS } from "@/lib/brand";

/**
 * Editorial number entry, shared by the macro popup (FilterPopup) and the
 * profile edit sheets so every "tweak a number" surface in the app reads the
 * same way as the web "Tweak macros" tile: bordered cream circles, a serif
 * figure, a small muted unit.
 *
 * `SerifField` is the figure + unit on its own (used for the ft / in pair);
 * `StepperControl` wraps it with − / + buttons.
 */

type Size = "md" | "lg";

/** Placeholders are hints, not values: textSoft at half strength so "70" never reads as a saved weight. */
const PLACEHOLDER = "rgba(122, 140, 126, 0.45)";

interface SerifFieldProps {
  value: string;
  unit?: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  /** Accessibility label for the +/- buttons ("Decrease {label}") and, unless
   *  `fieldLabel` is given, for the text field too. */
  label: string;
  /** Accessibility label for the text field itself, e.g. "Protein grams". */
  fieldLabel?: string;
  size?: Size;
  /** Allow a decimal point (weight). Default digits only. */
  decimal?: boolean;
}

export function SerifField({
  value,
  unit,
  onChangeText,
  placeholder = "—",
  maxLength = 4,
  label,
  fieldLabel,
  size = "md",
  decimal = false,
}: SerifFieldProps) {
  const lg = size === "lg";
  return (
    <View style={[s.valueCol, lg && s.valueColLg]}>
      <TextInput
        style={[s.numInput, lg && s.numInputLg]}
        value={value}
        onChangeText={(t) =>
          onChangeText(t.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, ""))
        }
        keyboardType={decimal ? "decimal-pad" : "number-pad"}
        placeholder={placeholder}
        placeholderTextColor={PLACEHOLDER}
        maxLength={maxLength}
        textAlign="right"
        selectTextOnFocus
        accessibilityLabel={fieldLabel ?? label}
      />
      {unit ? <Text style={[s.unit, lg && s.unitLg]}>{unit}</Text> : null}
    </View>
  );
}

interface StepperControlProps extends SerifFieldProps {
  /** Called with -1 or +1. The caller decides the step size. */
  onStep: (direction: -1 | 1) => void;
}

export function StepperControl({
  onStep,
  size = "md",
  label,
  ...field
}: StepperControlProps) {
  const lg = size === "lg";
  return (
    <View style={[s.control, lg && s.controlLg]}>
      <Pressable
        style={({ pressed }) => [
          s.stepper,
          lg && s.stepperLg,
          pressed && s.stepperPressed,
        ]}
        onPress={() => onStep(-1)}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        hitSlop={6}
      >
        <Text style={[s.stepperText, lg && s.stepperTextLg]}>−</Text>
      </Pressable>

      <SerifField {...field} label={label} size={size} />

      <Pressable
        style={({ pressed }) => [
          s.stepper,
          lg && s.stepperLg,
          pressed && s.stepperPressed,
        ]}
        onPress={() => onStep(1)}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        hitSlop={6}
      >
        <Text style={[s.stepperText, lg && s.stepperTextLg]}>+</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  control: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  controlLg: {
    gap: 14,
  },
  stepper: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    backgroundColor: EDITORIAL.creamCard,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperLg: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  stepperPressed: {
    backgroundColor: EDITORIAL.creamDeep,
  },
  stepperText: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 20,
    fontWeight: "400",
    color: EDITORIAL.green,
    marginTop: -1,
  },
  stepperTextLg: {
    fontSize: 24,
  },

  valueCol: {
    flexDirection: "row",
    alignItems: "baseline",
    minWidth: 66,
    justifyContent: "flex-end",
  },
  valueColLg: {
    minWidth: 96,
  },
  numInput: {
    fontFamily: FONTS.frauncesRegular,
    fontSize: 30,
    color: EDITORIAL.text,
    letterSpacing: -0.8,
    padding: 0,
    minWidth: 34,
  },
  numInputLg: {
    fontSize: 42,
    letterSpacing: -1.2,
    minWidth: 48,
  },
  unit: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 13,
    color: EDITORIAL.textSoft,
    marginLeft: 2,
  },
  unitLg: {
    fontSize: 15,
    marginLeft: 4,
  },
});
