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
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';

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
                <Ionicons name={opt.icon as any} size={18} color={active ? '#FDFBF7' : EDITORIAL.textSoft} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[s.choiceLabel, active && s.choiceLabelActive]}>{opt.label}</Text>
                {opt.description && (
                  <Text style={[s.choiceDesc, active && { color: 'rgba(253,251,247,0.6)' }]}>{opt.description}</Text>
                )}
              </View>
              {active && <Ionicons name="checkmark" size={18} color="#FDFBF7" />}
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

function NumericContent({ value, unit, placeholder, onApply, dismiss }: NumericProps & { dismiss: (cb: () => void) => void }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  return (
    <>
      <View style={s.numericRow}>
        <Pressable style={s.stepper} onPress={() => setDraft(String(Math.max(0, (parseInt(draft) || 0) - 1)))}>
          <Text style={s.stepperText}>−</Text>
        </Pressable>

        <TextInput
          style={s.numInput}
          value={draft}
          onChangeText={(t) => setDraft(t.replace(/[^0-9.]/g, ''))}
          keyboardType="number-pad"
          placeholder={placeholder ?? '—'}
          placeholderTextColor="#C8C8C8"
          maxLength={5}
          textAlign="center"
          selectTextOnFocus
        />
        <Text style={s.numUnit}>{unit}</Text>

        <Pressable style={s.stepper} onPress={() => setDraft(String((parseInt(draft) || 0) + 1))}>
          <Text style={s.stepperText}>+</Text>
        </Pressable>
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
      const totalInches = total / 2.54;
      setFt(String(Math.floor(totalInches / 12)));
      setInches(String(Math.round(totalInches % 12)));
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
          <TextInput
            style={s.numInput}
            value={cm}
            onChangeText={(t) => setCm(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="170"
            placeholderTextColor="#C8C8C8"
            maxLength={3}
            textAlign="center"
            selectTextOnFocus
          />
          <Text style={s.numUnit}>cm</Text>
        </View>
      ) : (
        <View style={s.heightImperial}>
          <View style={s.heightField}>
            <TextInput
              style={s.numInput}
              value={ft}
              onChangeText={(t) => setFt(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="5"
              placeholderTextColor="#C8C8C8"
              maxLength={1}
              textAlign="center"
              selectTextOnFocus
            />
            <Text style={s.numUnit}>ft</Text>
          </View>
          <View style={s.heightField}>
            <TextInput
              style={s.numInput}
              value={inches}
              onChangeText={(t) => setInches(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="9"
              placeholderTextColor="#C8C8C8"
              maxLength={2}
              textAlign="center"
              selectTextOnFocus
            />
            <Text style={s.numUnit}>in</Text>
          </View>
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
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 28,
    backgroundColor: '#FDFBF7',
    borderWidth: 1,
    borderColor: '#E8E2D8',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 10,
  },
  title: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 22,
    color: EDITORIAL.text,
    letterSpacing: -0.5,
    marginBottom: 18,
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
    fontSize: 15,
    fontWeight: '600',
    color: EDITORIAL.text,
    letterSpacing: -0.2,
  },
  choiceLabelActive: { color: '#FDFBF7' },
  choiceDesc: {
    fontSize: 12,
    color: EDITORIAL.textSoft,
    marginTop: 1,
  },

  // Numeric
  numericRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    marginBottom: 12,
  },
  stepper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0EBE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: {
    fontSize: 22,
    fontWeight: '300',
    color: '#3A4F41',
    marginTop: -1,
  },
  numInput: {
    flex: 1,
    fontSize: 40,
    fontWeight: '700',
    color: '#1B3A26',
    letterSpacing: -1.5,
    padding: 0,
    marginHorizontal: 8,
    maxWidth: 140,
  },
  numUnit: {
    fontSize: 18,
    fontWeight: '500',
    color: '#7A8C7E',
    marginRight: 8,
  },

  // Height imperial
  heightImperial: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
    paddingVertical: 20,
    marginBottom: 12,
  },
  heightField: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontSize: 13,
    fontWeight: '600',
    color: EDITORIAL.textSoft,
  },
  toggleTextActive: { color: '#FDFBF7' },

  // Apply
  applyBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#1B3A26',
  },
  applyText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FDFBF7',
    letterSpacing: -0.2,
  },
});
