import React, { useEffect } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AnimatedPress } from '@/components/AnimatedPress';
import { EDITORIAL, FONTS } from '@/lib/brand';

export type PaywallExitModal = 'none' | 'discount' | 'goodbye';

interface Props {
  modal: PaywallExitModal;
  discountPercent: number | null;
  discountDisclosure: string;
  trialAvailable: boolean;
  onClose: () => void;
  /** First skip: an available discount derived from the live offering. */
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
  discountPercent,
  discountDisclosure,
  trialAvailable,
  onClose,
  onClaimDiscount,
  onDeclineDiscount,
  onStartTrial,
  onMaybeLater,
}: Props) {
  useEffect(() => {
    if (modal === 'none') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => subscription.remove();
  }, [modal, onClose]);
  if (modal === 'none') return null;
  // An in-screen overlay keeps the native purchase presenter mounted. Dismissing
  // an RN Modal and opening StoreKit/Test Store in the same tap stranded purchases.
  return (
    <View style={s.overlay} accessibilityViewIsModal>
      {modal === 'discount' ? (
          <Animated.View entering={FadeIn.duration(300)} style={s.modal}>
            <Text style={s.modalTitle}>Eat well for less.</Text>
            <Text style={s.modalBody}>Save {discountPercent}% on your plan. {discountDisclosure}</Text>
            <AnimatedPress style={s.modalCta} onPress={onClaimDiscount} haptic accessibilityRole="button" testID="paywall-discount-buy">
              <Text style={s.modalCtaTxt}>Find meals for less</Text>
            </AnimatedPress>
            <AnimatedPress style={s.modalSkip} onPress={onDeclineDiscount} accessibilityRole="button" testID="paywall-discount-decline">
              <Text style={s.modalSkipTxt}>No thanks</Text>
            </AnimatedPress>
          </Animated.View>
      ) : (
          <Animated.View entering={FadeIn.duration(300)} style={s.modal}>
            <Text style={s.goodbyeTitle}>Your next meal,{'\n'}without the guesswork.</Text>
            <Text style={s.modalBody}>
              A Fitsy subscription unlocks nearby meals matched to your macros, so you can enjoy eating out and stay on track.
            </Text>
            <AnimatedPress style={s.modalCta} onPress={onStartTrial} haptic accessibilityRole="button" testID="paywall-return-to-plan">
              <Text style={s.modalCtaTxt}>{trialAvailable ? 'Find meals that fit — free' : 'Find meals that fit'}</Text>
            </AnimatedPress>
            <AnimatedPress style={s.modalSkip} onPress={onMaybeLater} accessibilityRole="button" testID="paywall-decline">
              <Text style={s.modalSkipTxt}>Maybe later</Text>
            </AnimatedPress>
          </Animated.View>
      )}
      <AnimatedPress style={s.modalSkip} onPress={onClose} accessibilityRole="button" testID="paywall-back-to-plans">
        <Text style={s.backTxt}>Back to plans</Text>
      </AnimatedPress>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,31,21,0.75)', justifyContent: 'center', padding: 28 },
  modal: { backgroundColor: EDITORIAL.cream, borderRadius: 28, padding: 36, alignItems: 'center', gap: 16 },
  modalTitle: { fontFamily: FONTS.frauncesDisplay, fontSize: 30, color: EDITORIAL.text, letterSpacing: -1 },
  goodbyeTitle: { fontFamily: FONTS.frauncesDisplay, fontSize: 28, color: EDITORIAL.text, letterSpacing: -0.8, textAlign: 'center' },
  modalBody: { fontFamily: FONTS.nunitoSans, fontSize: 16, lineHeight: 24, color: EDITORIAL.textSoft, textAlign: 'center' },
  bold: { fontWeight: '700' },
  modalCta: { backgroundColor: EDITORIAL.green, borderRadius: 32, paddingVertical: 18, width: '100%', alignItems: 'center', marginTop: 8 },
  modalCtaTxt: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, fontWeight: '600', color: EDITORIAL.cream },
  modalSkip: { paddingVertical: 8 },
  modalSkipTxt: { fontFamily: FONTS.nunitoSans, fontSize: 14, color: EDITORIAL.textSoft },
  backTxt: { fontFamily: FONTS.nunitoSans, fontSize: 15, color: EDITORIAL.cream, textAlign: 'center' },
});
