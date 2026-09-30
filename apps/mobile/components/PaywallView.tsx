import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedPress } from './AnimatedPress';
import { WelcomeNav } from './WelcomeNav';
import { PaywallTimeline } from './PaywallTimeline';
import { PaywallHero } from './PaywallHero';
import { EDITORIAL, FONTS, TEXT } from '@/lib/brand';
import { openLegalLink } from '@/lib/legalLinks';
import type { purchaseTerms } from '@/lib/purchaseTerms';

type Terms = ReturnType<typeof purchaseTerms>;
type PlanId = 'monthly' | 'yearly';
interface Props {
  plan: PlanId;
  annual: Terms;
  monthly: Terms;
  loading: boolean;
  restoring: boolean;
  checkingPlans: boolean;
  visualPreview?: boolean;
  onSelect: (plan: PlanId) => void;
  onBack?: () => void;
  onRestore: () => void;
  onManage: () => void;
  onRetry: () => void;
  onPurchase: () => void;
  onDecline: () => void;
}

/** The store supplies all offer copy; this component owns only presentation. */
export function PaywallView(props: Props) {
  const { height, fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.35;
  const compact = height < 780 && fontScale <= 1.2;
  const { plan, annual, monthly, loading, restoring } = props;
  const selected = plan === 'yearly' ? annual : monthly;
  const busy = loading || restoring;
  const planBusy = busy || props.checkingPlans;
  const trialLength = selected?.trialDays ? `${selected.trialDays}-day` : selected?.trial;
  const label = loading ? 'Setting up…' : props.checkingPlans ? 'Checking plans…' : selected?.trial ? `Start ${trialLength} free trial` : 'Continue to purchase';

  return (
    <SafeAreaView key={fontScale} style={s.safe}>
      <WelcomeNav progress={1} onBack={!busy ? props.onBack : undefined} trailing={
        <Pressable onPress={props.onRestore} disabled={busy} style={s.navAction} accessibilityRole="button" testID="paywall-restore">
          <Text style={[s.restore, busy && s.disabled]}>{restoring ? 'Restoring…' : 'Restore'}</Text>
        </Pressable>
      } />

      <ScrollView style={s.scroll} contentContainerStyle={[s.content, compact && s.contentCompact]} showsVerticalScrollIndicator={false} bounces={false}>
        <View>
          <PaywallHero compact={compact} />
          <Text style={[s.title, compact && s.titleCompact]}>Find meals that fit.</Text>
          <View style={[s.benefits, compact && s.benefitsCompact]}>
            <Text style={[s.benefit, compact && s.benefitCompact]}>Discover nearby meals for your goals.</Text>
            <Text style={[s.benefit, compact && s.benefitCompact]}>Compare estimated nutrition at a glance.</Text>
          </View>
          {props.visualPreview && <Text style={s.visualNote} testID="dev-trial-visual-note">Synthetic trial eligibility for visual testing. Prices are from the live Test Store; purchase is disabled.</Text>}
          <View style={s.plans}>
            {([{ id: 'monthly', name: 'Monthly', terms: monthly }, { id: 'yearly', name: 'Annual', terms: annual }] as const).map(option => {
              const active = option.id === plan;
              return (
                <AnimatedPress key={option.id} style={[s.plan, compact && s.planCompact, largeText && s.planLarge, active && s.planSelected]} onPress={() => props.onSelect(option.id)}
                  disabled={planBusy || !option.terms} haptic accessibilityRole="radio" accessibilityState={{ checked: active, disabled: planBusy || !option.terms }} testID={`paywall-plan-${option.id}`}>
                  <View style={[s.radio, active && s.radioSelected]} accessible={false}>
                    {active && <Ionicons name="checkmark" size={13} color={EDITORIAL.cream} />}
                  </View>
                  <View style={s.planInfo}>
                    <Text style={s.planName}>{option.name}</Text>
                    {!!option.terms?.trial && <Text style={s.planNote}>{option.terms.trial} free</Text>}
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
          <PaywallTimeline terms={selected} compact={compact} concise />
        </View>
      </ScrollView>

        <View style={[s.footer, compact && s.footerCompact]}>
          <Text style={[s.disclosure, compact && s.disclosureCompact]} testID="paywall-terms">{selected?.compactDisclosure ?? 'Fetching current prices and subscription terms from the store…'}</Text>
          <AnimatedPress style={[s.cta, compact && s.ctaCompact, (!selected || planBusy) && s.disabled]} onPress={props.onPurchase} disabled={!selected || planBusy} haptic
            accessibilityRole="button" accessibilityLabel={label} testID="welcome-continue">
            <Text style={s.ctaText}>{label}</Text><Ionicons name="arrow-forward" size={17} color={EDITORIAL.cream} />
          </AnimatedPress>
          <View style={s.links}>
            <Pressable style={s.legalHit} onPress={props.onManage} accessibilityRole="link" testID="paywall-manage-link"><Text style={s.legalLink}>Manage</Text></Pressable>
            <Pressable style={s.legalHit} onPress={() => openLegalLink('terms')} accessibilityRole="link" testID="paywall-terms-link"><Text style={s.legalLink}>Terms</Text></Pressable>
            <Pressable style={s.legalHit} onPress={() => openLegalLink('privacy')} accessibilityRole="link" testID="paywall-privacy-link"><Text style={s.legalLink}>Privacy</Text></Pressable>
          </View>
          <Pressable style={s.decline} onPress={props.onDecline} disabled={busy} accessibilityRole="button" testID="welcome-skip"><Text style={[s.declineText, busy && s.disabled]}>Not now</Text></Pressable>
        </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  scroll: { flex: 1 },
  navAction: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  restore: { fontFamily: FONTS.nunitoSans, fontSize: 12, color: EDITORIAL.textMid, textDecorationLine: 'underline', textAlign: 'right' },
  content: { paddingHorizontal: 28, paddingTop: 10, paddingBottom: 22 },
  contentCompact: { paddingHorizontal: 20, paddingTop: 4 },
  title: { ...TEXT.title, fontSize: 26, lineHeight: 32, color: EDITORIAL.green, textAlign: 'center' },
  titleCompact: { fontSize: 23, lineHeight: 29 },
  benefits: { alignItems: 'center', gap: 4, marginTop: 7, marginBottom: 18 },
  benefitsCompact: { gap: 2, marginTop: 4, marginBottom: 8 },
  benefit: { fontFamily: FONTS.nunitoSans, fontSize: 13, lineHeight: 19, color: EDITORIAL.textMid, textAlign: 'center' },
  benefitCompact: { fontSize: 12, lineHeight: 17 },
  visualNote: { ...TEXT.bodySmall, fontSize: 11, lineHeight: 15, color: EDITORIAL.textMid, textAlign: 'center', marginBottom: 8 },
  plans: { gap: 9, marginBottom: 8 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 68, borderRadius: 15, borderWidth: 1, borderColor: EDITORIAL.border },
  planCompact: { paddingVertical: 7, minHeight: 58, gap: 10 },
  planSelected: { backgroundColor: EDITORIAL.greenAccentTint, borderColor: EDITORIAL.greenMid },
  planLarge: { paddingHorizontal: 10 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: EDITORIAL.textSoft, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: EDITORIAL.greenMid, borderColor: EDITORIAL.greenMid },
  planInfo: { flex: 1, minWidth: 0 },
  planName: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 15, lineHeight: 20, color: EDITORIAL.green },
  planNote: { fontFamily: FONTS.nunitoSans, fontSize: 11, lineHeight: 15, color: EDITORIAL.textMid, marginTop: 1 },
  priceWrap: { alignItems: 'flex-end', flexShrink: 1 },
  priceWrapLarge: { flexShrink: 1 },
  price: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 19, color: EDITORIAL.green },
  pricePeriod: { fontFamily: FONTS.nunitoSans, fontSize: 11, color: EDITORIAL.textMid },
  retry: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { borderTopWidth: 1, borderColor: EDITORIAL.border, backgroundColor: EDITORIAL.cream, paddingHorizontal: 28, paddingTop: 10 },
  footerCompact: { paddingHorizontal: 20, paddingTop: 7 },
  disclosure: { fontFamily: FONTS.nunitoSans, fontSize: 11, lineHeight: 15, color: EDITORIAL.textMid, textAlign: 'center', marginBottom: 8 },
  disclosureCompact: { marginBottom: 6 },
  cta: { minHeight: 50, paddingVertical: 11, paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, borderRadius: 30, backgroundColor: EDITORIAL.green },
  ctaCompact: { minHeight: 46, paddingVertical: 8 },
  ctaText: { flexShrink: 1, fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, lineHeight: 22, color: EDITORIAL.cream, textAlign: 'center' },
  disabled: { opacity: 0.4 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 4 },
  legalHit: { minWidth: 48, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  legalLink: { fontFamily: FONTS.nunitoSans, fontSize: 11, color: EDITORIAL.textMid, textDecorationLine: 'underline' },
  decline: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  declineText: { fontFamily: FONTS.nunitoSans, fontSize: 12, color: EDITORIAL.textMid },
});
