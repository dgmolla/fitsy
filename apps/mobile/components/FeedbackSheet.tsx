import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { FEEDBACK_MAX_LENGTH } from '@fitsy/shared';
import { EDITORIAL, FONTS } from '@/lib/brand';

interface FeedbackSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Submit handler. Resolve true on success, false to keep the sheet open. */
  onSubmit: (message: string) => Promise<boolean>;
}

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

export function FeedbackSheet({ visible, onClose, onSubmit }: FeedbackSheetProps) {
  const { scaleAnim, opacityAnim, blurOpacity, translateY, dismiss } = useSheetAnimation(visible);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setDraft('');
      setSubmitting(false);
    }
  }, [visible]);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  function handleClose() {
    if (submitting) return;
    dismiss(onClose);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const ok = await onSubmit(trimmed);
    if (ok) {
      dismiss(onClose);
    } else {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}>
        <BlurView tint="light" intensity={60} style={StyleSheet.absoluteFill as ViewStyle} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
      </Animated.View>

      <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.overlay}
        pointerEvents="box-none"
      >
        <Animated.View style={[s.card, { opacity: opacityAnim, transform: [{ scale: scaleAnim }, { translateY }] }]}>
          <Text style={s.title}>Send feedback</Text>
          <Text style={s.subtitle}>
            Found a bug or have an idea? Tell us anything — it goes straight to the team.
          </Text>

          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="What's on your mind?"
            placeholderTextColor="#B6B0A4"
            multiline
            textAlignVertical="top"
            maxLength={FEEDBACK_MAX_LENGTH}
            autoFocus
            editable={!submitting}
          />

          <Pressable
            style={[s.submitBtn, !canSubmit && s.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FDFBF7" />
            ) : (
              <Text style={s.submitText}>Send</Text>
            )}
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
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
    paddingTop: 24,
    paddingBottom: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 10,
  },
  title: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 22,
    color: EDITORIAL.text,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 13,
    color: EDITORIAL.textSoft,
    lineHeight: 18,
    marginBottom: 16,
  },
  input: {
    minHeight: 120,
    borderRadius: 14,
    backgroundColor: EDITORIAL.creamCard,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: FONTS.nunitoSans,
    fontSize: 15,
    color: EDITORIAL.text,
    marginBottom: 16,
  },
  submitBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1B3A26',
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitText: {
    fontFamily: FONTS.nunitoSansSemiBold,
    fontSize: 16,
    fontWeight: '700',
    color: '#FDFBF7',
    letterSpacing: -0.2,
  },
});
