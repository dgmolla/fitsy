import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedPress } from './AnimatedPress';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { openLegalLink } from '@/lib/legalLinks';
import type { purchaseTerms } from '@/lib/purchaseTerms';

type Terms = ReturnType<typeof purchaseTerms>;
type PlanId = 'monthly' | 'yearly';
interface Props {
  plan: PlanId;
  annual: Terms;
  monthly: Terms;
  showImage: boolean;
  loading: boolean;
  restoring: boolean;
  onSelect: (plan: PlanId) => void;
  onBack: () => void;
  onRestore: () => void;
  onRetry: () => void;
  onPurchase: () => void;
  onDecline: () => void;
}

/** The store supplies all offer copy; this component owns only presentation. */
export function PaywallView(props: Props) {
  const { height, fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.35;
  const { plan, annual, monthly, loading, restoring } = props;
  const selected = plan === 'yearly' ? annual : monthly;
  const busy = loading || restoring;
  const label = loading ? 'Setting up…' : selected?.trial ? 'Try meals that fit for free' : 'Unlock meals that fit';

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.nav}>
        <Pressable onPress={props.onBack} style={s.navAction} accessibilityRole="button" accessibilityLabel="Go back" testID="welcome-back">
          <Ionicons name="chevron-back" size={23} color={EDITORIAL.textMid} />
        </Pressable>
        {!largeText && <Text style={s.wordmark} accessibilityLabel="Fitsy Pro">fitsy pro</Text>}
        <Pressable onPress={props.onRestore} disabled={busy} style={s.navAction} accessibilityRole="button" testID="paywall-restore">
          <Text style={[s.restore, busy && s.disabled]}>{restoring ? 'Restoring…' : 'Restore'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} bounces={false}>
        <View>
          {props.showImage && (
            <View style={[s.photo, { height: Math.max(130, Math.min(187, height * 0.2)) }]}>
              <Image source={require('@/assets/dishes/19.jpg')} style={s.image} accessibilityLabel="Meal inspiration" testID="paywall-meal-image" />
              <Text style={s.imageLabel}>Meal inspiration</Text>
            </View>
          )}
          <Text style={s.hero}>Eat out.{'\n'}Stay on track.</Text>
          <Text style={s.subtitle}>Find nearby dishes that fit your macros.</Text>

          <View style={s.plans}>
            {([{ id: 'yearly', name: 'Annual', terms: annual }, { id: 'monthly', name: 'Monthly', terms: monthly }] as const).map(option => {
              const active = option.id === plan;
              return (
                <AnimatedPress key={option.id} style={[s.plan, largeText && s.planLarge, active && s.planSelected]} onPress={() => props.onSelect(option.id)}
                  disabled={busy} haptic accessibilityRole="radio" accessibilityState={{ checked: active, disabled: busy }} testID={`paywall-plan-${option.id}`}>
                  <View style={[s.radio, active && s.radioSelected]} accessible={false}>
                    {active && <Ionicons name="checkmark" size={13} color={EDITORIAL.cream} />}
                  </View>
                  <View style={s.planInfo}>
                    <Text style={s.planName}>{option.name}</Text>
                    <Text style={s.planNote}>{option.terms?.trial ? `${option.terms.trial} free` : option.terms ? `Billed every ${option.terms.period}` : 'Fetching store terms…'}</Text>
                  </View>
                  <View style={[s.priceWrap, largeText && s.priceWrapLarge]}>
                    <Text testID={`paywall-price-${option.id}`} style={s.price}>{option.terms?.price ?? 'Loading…'}</Text>
                    {!!option.terms && <Text style={s.pricePeriod}>/{option.terms.periodShort}</Text>}
                  </View>
                </AnimatedPress>
              );
            })}
          </View>
          {!selected && (
            <Pressable style={s.retry} onPress={props.onRetry} accessibilityRole="button" testID="paywall-retry-pricing">
              <Text style={s.restore}>Retry loading plans</Text>
            </Pressable>
          )}
        </View>

        <View style={s.footer}>
          {!!selected?.trial && <Text style={s.noPayment} testID="paywall-no-payment">No payment today</Text>}
          <Text style={s.disclosure} testID="paywall-terms">{selected?.compactDisclosure ?? 'Fetching current prices and subscription terms from the store…'}</Text>
          <AnimatedPress style={[s.cta, (!selected || busy) && s.disabled]} onPress={props.onPurchase} disabled={!selected || busy} haptic
            accessibilityRole="button" accessibilityLabel={label} testID="welcome-continue">
            <Text style={s.ctaText}>{label}</Text><Ionicons name="arrow-forward" size={17} color={EDITORIAL.cream} />
          </AnimatedPress>
          <View style={s.links}>
            <Pressable style={s.legalHit} onPress={() => openLegalLink('terms')} accessibilityRole="link" testID="paywall-terms-link"><Text style={s.legalLink}>Terms</Text></Pressable>
            <Pressable style={s.legalHit} onPress={() => openLegalLink('privacy')} accessibilityRole="link" testID="paywall-privacy-link"><Text style={s.legalLink}>Privacy</Text></Pressable>
          </View>
          <Pressable style={s.decline} onPress={props.onDecline} disabled={busy} accessibilityRole="button" testID="welcome-skip"><Text style={[s.declineText, busy && s.disabled]}>Not now</Text></Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  nav: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  navAction: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  wordmark: { fontFamily: FONTS.frauncesDisplay, fontSize: 20, color: EDITORIAL.green },
  restore: { fontFamily: FONTS.nunitoSans, fontSize: 12, color: EDITORIAL.textMid, textDecorationLine: 'underline', textAlign: 'right' },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 2 },
  photo: { width: '100%', borderRadius: 22, overflow: 'hidden', marginBottom: 16 },
  image: { width: '100%', height: '100%', resizeMode: 'cover' },
  imageLabel: { position: 'absolute', left: 10, bottom: 10, backgroundColor: EDITORIAL.cream, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12, fontFamily: FONTS.nunitoSansSemiBold, fontSize: 9, color: EDITORIAL.green },
  hero: { fontFamily: FONTS.frauncesDisplay, fontSize: 34, lineHeight: 37, letterSpacing: -0.8, color: EDITORIAL.green },
  subtitle: { fontFamily: FONTS.nunitoSans, fontSize: 14, lineHeight: 20, color: EDITORIAL.textMid, marginTop: 8, marginBottom: 16 },
  plans: { gap: 8 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 62, borderRadius: 15, borderWidth: 1, borderColor: EDITORIAL.border },
  planSelected: { backgroundColor: EDITORIAL.greenAccentTint, borderColor: EDITORIAL.greenMid },
  planLarge: { flexWrap: 'wrap' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: EDITORIAL.textSoft, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: EDITORIAL.greenMid, borderColor: EDITORIAL.greenMid },
  planInfo: { flex: 1 },
  planName: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 15, lineHeight: 20, color: EDITORIAL.green },
  planNote: { fontFamily: FONTS.nunitoSans, fontSize: 11, lineHeight: 15, color: EDITORIAL.textMid, marginTop: 1 },
  priceWrap: { alignItems: 'flex-end', flexShrink: 1, maxWidth: '48%' },
  priceWrapLarge: { width: '100%', maxWidth: '100%', alignItems: 'flex-start', paddingLeft: 30, flexShrink: 0 },
  price: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 19, color: EDITORIAL.green },
  pricePeriod: { fontFamily: FONTS.nunitoSans, fontSize: 11, color: EDITORIAL.textMid },
  retry: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { marginTop: 'auto', paddingTop: 16 },
  noPayment: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 12, lineHeight: 18, color: EDITORIAL.greenMid, textAlign: 'center', marginBottom: 8 },
  disclosure: { fontFamily: FONTS.nunitoSans, fontSize: 11, lineHeight: 16, color: EDITORIAL.textMid, textAlign: 'center', marginBottom: 12 },
  cta: { minHeight: 54, paddingVertical: 14, paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, borderRadius: 30, backgroundColor: EDITORIAL.green },
  ctaText: { flexShrink: 1, fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, lineHeight: 22, color: EDITORIAL.cream, textAlign: 'center' },
  disabled: { opacity: 0.4 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 4 },
  legalHit: { minWidth: 48, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  legalLink: { fontFamily: FONTS.nunitoSans, fontSize: 11, color: EDITORIAL.textMid, textDecorationLine: 'underline' },
  decline: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  declineText: { fontFamily: FONTS.nunitoSans, fontSize: 12, color: EDITORIAL.textMid },
});
