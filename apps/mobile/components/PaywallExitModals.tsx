import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AnimatedPress } from '@/components/AnimatedPress';
import { EDITORIAL, FONTS } from '@/lib/brand';

export type PaywallExitModal = 'none' | 'discount' | 'goodbye';

interface Props {
  modal: PaywallExitModal;
  /** Live, store-localized discounted annual price (or the designed fallback). */
  discountPrice: string;
  onClose: () => void;
  /** First skip: the 25%-off offer. */
  onClaimDiscount: () => void;
  onDeclineDiscount: () => void;
  /** Second skip: last chance to start the trial. */
  onStartTrial: () => void;
  /** Declining every offer: falls through to the locked search teaser. */
  onMaybeLater: () => void;
}

/**
 * The two exit-intent modals the paywall (app/welcome/payment.tsx) shows on
 * skip: the discount offer first, the goodbye screen second. Pure
 * presentation; the paywall owns which one is open and what each tap does.
 */
export function PaywallExitModals({
  modal,
  discountPrice,
  onClose,
  onClaimDiscount,
  onDeclineDiscount,
  onStartTrial,
  onMaybeLater,
}: Props) {
  return (
    <>
      {/* Discount modal - first skip */}
      <Modal visible={modal === 'discount'} transparent animationType="fade" onRequestClose={onClose}>
        <View style={s.overlay}>
          <Animated.View entering={FadeIn.duration(300)} style={s.modal}>
            <Text style={s.modalTitle}>Wait, 25% off.</Text>
            <Text style={s.modalBody}>
              Lock in <Text style={s.bold}>{discountPrice}</Text> for your first year, billed today.
            </Text>
            <AnimatedPress style={s.modalCta} onPress={onClaimDiscount} haptic>
              <Text style={s.modalCtaTxt}>Claim 25% Off</Text>
            </AnimatedPress>
            <AnimatedPress style={s.modalSkip} onPress={onDeclineDiscount}>
              <Text style={s.modalSkipTxt}>No thanks</Text>
            </AnimatedPress>
          </Animated.View>
        </View>
      </Modal>

      {/* Goodbye screen - second skip */}
      <Modal visible={modal === 'goodbye'} transparent animationType="fade" onRequestClose={onClose}>
        <View style={s.overlay}>
          <Animated.View entering={FadeIn.duration(300)} style={s.modal}>
            <Text style={s.goodbyeTitle}>We're sorry to{'\n'}see you go.</Text>
            <Text style={s.modalBody}>
              Fitsy requires a subscription to access personalized restaurant recommendations. You can start a free trial anytime.
            </Text>
            <AnimatedPress style={s.modalCta} onPress={onStartTrial} haptic>
              <Text style={s.modalCtaTxt}>Start Free Trial</Text>
            </AnimatedPress>
            <AnimatedPress style={s.modalSkip} onPress={onMaybeLater}>
              <Text style={s.modalSkipTxt}>Maybe later</Text>
            </AnimatedPress>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,31,21,0.55)', justifyContent: 'center', padding: 36 },
  modal: { backgroundColor: EDITORIAL.cream, borderRadius: 28, padding: 36, alignItems: 'center', gap: 16 },
  modalTitle: { fontFamily: FONTS.frauncesDisplay, fontSize: 30, color: EDITORIAL.text, letterSpacing: -1 },
  goodbyeTitle: { fontFamily: FONTS.frauncesDisplay, fontSize: 28, color: EDITORIAL.text, letterSpacing: -0.8, textAlign: 'center' },
  modalBody: { fontFamily: FONTS.nunitoSans, fontSize: 16, lineHeight: 24, color: EDITORIAL.textSoft, textAlign: 'center' },
  bold: { fontWeight: '700' },
  modalCta: { backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18, width: '100%', alignItems: 'center', marginTop: 8 },
  modalCtaTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  modalSkip: { paddingVertical: 8 },
  modalSkipTxt: { fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.textSoft },
});
