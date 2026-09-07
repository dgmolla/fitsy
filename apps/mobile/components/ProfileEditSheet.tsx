import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { SerifField, StepperControl } from '@/components/StepperControl';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChoiceOption {
  id: string;
  label: string;
  icon?: string;
  description?: string;
}

interface BaseProps {
  visible: boolean;
  title: string;
  onClose: () => void;
}

interface ChoiceProps extends BaseProps {
  type: 'choice';
  options: ChoiceOption[];
  value: string;
  onApply: (value: string) => void;
}

interface NumericProps extends BaseProps {
  type: 'numeric';
  value: string;
  unit: string;
  placeholder?: string;
  onApply: (value: string) => void;
}

interface HeightProps extends BaseProps {
  type: 'height';
  valueCm: string;
  onApply: (valueCm: string) => void;
}

export type ProfileEditSheetProps = ChoiceProps | NumericProps | HeightProps;

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// ─── Shared animation hooks ─────────────────────────────────────────────────

function useSheetAnimation(visible: boolean) {
  const scaleAnim = useRef(new Animated.Value(0.72)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const blurOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0.72);
      opacityAnim.setValue(0);
      blurOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, damping: 14, stiffness: 340, mass: 0.72, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(blurOpacity, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
  }, [visible, scaleAnim, opacityAnim, blurOpacity]);

  function dismiss(cb: () => void) {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.88, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 130, useNativeDriver: true }),
      Animated.timing(blurOpacity, { toValue: 0, duration: 130, useNativeDriver: true }),
    ]).start(() => cb());
  }

  const translateY = scaleAnim.interpolate({
    inputRange: [0.72, 1],
    outputRange: [-40, 0],
    extrapolate: 'clamp',
  });

  return { scaleAnim, opacityAnim, blurOpacity, translateY, dismiss };
}

// ─── Main component ─────────────────────────────────────────────────────────

export function ProfileEditSheet(props: ProfileEditSheetProps) {
  const { visible, title, onClose } = props;
  const { scaleAnim, opacityAnim, blurOpacity, translateY, dismiss } = useSheetAnimation(visible);

  return (
    <Modal visible={visible} transparent animationType="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}>
        <BlurView tint="light" intensity={60} style={StyleSheet.absoluteFill as ViewStyle} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
      </Animated.View>

      <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss(onClose)} />

      <View style={s.overlay} pointerEvents="box-none">
        <Animated.View style={[s.card, { opacity: opacityAnim, transform: [{ scale: scaleAnim }, { translateY }] }]}>
          <Text style={s.title}>{title}</Text>

          {props.type === 'choice' && <ChoiceContent {...props} dismiss={dismiss} />}
          {props.type === 'numeric' && <NumericContent {...props} dismiss={dismiss} />}
          {props.type === 'height' && <HeightContent {...props} dismiss={dismiss} />}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Choice content ─────────────────────────────────────────────────────────

function ChoiceContent({ options, value, onApply, dismiss }: ChoiceProps & { dismiss: (cb: () => void) => void }) {
  const [selected, setSelected] = useState(value);

  useEffect(() => { setSelected(value); }, [value]);

  return (
    <>
      <View style={s.choiceList}>
        {options.map((opt) => {
          const active = selected === opt.id;
          return (
            <Pressable
              key={opt.id}
              style={[s.choiceRow, active && s.choiceRowActive]}
              onPress={() => setSelected(opt.id)}
            >
              {opt.icon && (
                <Ionicons name={opt.icon as any} size={18} color={active ? EDITORIAL.cream : EDITORIAL.textSoft} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[s.choiceLabel, active && s.choiceLabelActive]}>{opt.label}</Text>
                {opt.description && (
                  <Text style={[s.choiceDesc, active && { color: 'rgba(253,251,247,0.6)' }]}>{opt.description}</Text>
                )}
              </View>
              {active && <Ionicons name="checkmark" size={18} color={EDITORIAL.cream} />}
            </Pressable>
          );
        })}
      </View>
      <Pressable style={s.applyBtn} onPress={() => dismiss(() => onApply(selected))}>
        <Text style={s.applyText}>Apply</Text>
      </Pressable>
    </>
  );
}

// ─── Numeric content ────────────────────────────────────────────────────────

function NumericContent({ title, value, unit, placeholder, onApply, dismiss }: NumericProps & { dismiss: (cb: () => void) => void }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  return (
    <>
      <View style={s.numericRow}>
        <StepperControl
          size="lg"
          label={title}
          value={draft}
          unit={unit}
          placeholder={placeholder}
          maxLength={5}
          onChangeText={setDraft}
          onStep={(dir) => setDraft((prev) => String(clampInt((parseInt(prev, 10) || 0) + dir, 0, 99999)))}
        />
      </View>
      <Pressable style={s.applyBtn} onPress={() => dismiss(() => onApply(draft))}>
        <Text style={s.applyText}>Apply</Text>
      </Pressable>
    </>
  );
}

// ─── Height content (ft/in or cm) ───────────────────────────────────────────

function HeightContent({ valueCm, onApply, dismiss }: HeightProps & { dismiss: (cb: () => void) => void }) {
  const [mode, setMode] = useState<'imperial' | 'metric'>('metric');
  const [cm, setCm] = useState(valueCm);
  const [ft, setFt] = useState('');
  const [inches, setInches] = useState('');

  useEffect(() => {
    setCm(valueCm);
    if (valueCm) {
      const total = parseFloat(valueCm);
      // Round the whole-inch total first so 71.65in becomes 6'0", not 5'12".
      const totalInches = Math.round(total / 2.54);
      setFt(String(Math.floor(totalInches / 12)));
      setInches(String(totalInches % 12));
    }
  }, [valueCm]);

  function getCm(): string {
    if (mode === 'metric') return cm;
    const totalInches = (parseInt(ft) || 0) * 12 + (parseInt(inches) || 0);
    return String(Math.round(totalInches * 2.54));
  }

  return (
    <>
      {/* Unit toggle */}
      <View style={s.toggleRow}>
        <Pressable style={[s.toggleBtn, mode === 'imperial' && s.toggleActive]} onPress={() => setMode('imperial')}>
          <Text style={[s.toggleText, mode === 'imperial' && s.toggleTextActive]}>ft / in</Text>
        </Pressable>
        <Pressable style={[s.toggleBtn, mode === 'metric' && s.toggleActive]} onPress={() => setMode('metric')}>
          <Text style={[s.toggleText, mode === 'metric' && s.toggleTextActive]}>cm</Text>
        </Pressable>
      </View>

      {mode === 'metric' ? (
        <View style={s.numericRow}>
          <StepperControl
            size="lg"
            label="Height in centimeters"
            value={cm}
            unit="cm"
            placeholder="170"
            maxLength={3}
            onChangeText={setCm}
            onStep={(dir) => setCm((prev) => String(clampInt((parseInt(prev, 10) || 0) + dir, 0, 999)))}
          />
        </View>
      ) : (
        <View style={s.heightImperial}>
          <SerifField size="lg" label="Height feet" value={ft} unit="ft" placeholder="5" maxLength={1} onChangeText={setFt} />
          <SerifField size="lg" label="Height inches" value={inches} unit="in" placeholder="9" maxLength={2} onChangeText={setInches} />
        </View>
      )}

      <Pressable style={s.applyBtn} onPress={() => dismiss(() => onApply(getCm()))}>
        <Text style={s.applyText}>Apply</Text>
      </Pressable>
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  // Keep in step with FilterPopup's card (mirrors the web "Tweak macros" tile).
  card: {
    width: '100%',
    maxWidth: 356,
    borderRadius: 24,
    backgroundColor: EDITORIAL.cream,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    shadowColor: '#000',
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

  // Choice
  choiceList: { gap: 6, marginBottom: 18 },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: EDITORIAL.creamCard,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
  },
  choiceRowActive: {
    backgroundColor: EDITORIAL.green,
    borderColor: EDITORIAL.green,
  },
  choiceLabel: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 15,
    fontWeight: '600',
    color: EDITORIAL.text,
    letterSpacing: -0.2,
  },
  choiceLabelActive: { color: EDITORIAL.cream },
  choiceDesc: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 12,
    color: EDITORIAL.textSoft,
    marginTop: 1,
  },

  // Numeric
  numericRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 22,
    marginBottom: 10,
  },

  // Height imperial
  heightImperial: {
    flexDirection: 'row',
    gap: 28,
    justifyContent: 'center',
    paddingVertical: 22,
    marginBottom: 10,
  },

  // Toggle
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 12,
    padding: 3,
    marginBottom: 8,
  },
  toggleBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  toggleActive: { backgroundColor: EDITORIAL.green },
  toggleText: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 13,
    fontWeight: '600',
    color: EDITORIAL.textSoft,
  },
  toggleTextActive: { color: EDITORIAL.cream },

  // Apply
  applyBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: EDITORIAL.green,
  },
  applyText: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 15,
    fontWeight: '700',
    color: EDITORIAL.cream,
    letterSpacing: -0.2,
  },
});
