import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedPress } from './AnimatedPress';
import { PaywallHero, PaywallMosaic } from './PaywallHero';
import { EDITORIAL, FONTS, TEXT } from '@/lib/brand';
import { openLegalLink } from '@/lib/legalLinks';
import type { purchaseTerms } from '@/lib/purchaseTerms';
import type { PaywallDiscovery } from '@/lib/usePaywallDiscovery';
import type { PaywallVariant } from '@/lib/paywallVariant';
import { PAYWALL_BENEFITS, PaywallOfferTimeline, type ReminderAvailability } from './PaywallOfferTimeline';

type Terms = ReturnType<typeof purchaseTerms>;
type PlanId = 'monthly' | 'yearly';
interface Props {
  plan: PlanId;
  annual: Terms;
  monthly: Terms;
  annualSavingPercent: number | null;
  discovery: PaywallDiscovery;
  variant?: PaywallVariant;
  reminderAvailability?: ReminderAvailability;
  loading: boolean;
  restoring: boolean;
  checkingPlans: boolean;
  visualPreview?: 7 | 14;
  visualReminderSimulated?: boolean;
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
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const current = new Date();
      setNow(current);
      const nextMidnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      timeout = setTimeout(refresh, Math.max(1000, nextMidnight.getTime() - current.getTime()));
    };
    refresh();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') { clearTimeout(timeout); refresh(); }
    });
    return () => { clearTimeout(timeout); listener.remove(); };
  }, []);
  const { height, fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.35;
  const compact = height < 780 && fontScale <= 1.2;
  const timelineLayout = props.variant === 'B';
  const { plan, annual, monthly, loading, restoring } = props;
  const selected = plan === 'yearly' ? annual : monthly;
  const safe = useRef<View>(null);
  const [firstStepTop, setFirstStepTop] = useState<number | null>(null);
  const onFirstStepTop = useCallback((screenTop: number) => {
    safe.current?.measureInWindow((_, rootTop) => {
      const top = screenTop - rootTop;
      setFirstStepTop(previous => previous !== null && Math.abs(previous - top) < 1 ? previous : top);
    });
  }, []);
  const trialTimeline = timelineLayout && !!selected?.trial;
  // Layout measurements keep the fade above Today as the content moves with
  // screen height, selected offer, and accessibility text size.
  const mosaicHeight = trialTimeline
    ? firstStepTop === null ? Math.min(height * 0.2, 180) : Math.max(44, firstStepTop - 8)
    : Math.max(300, Math.min(height * 0.49, 410));
  const busy = loading || restoring;
  const planBusy = busy || props.checkingPlans;
  const label = loading ? 'Setting up…' : props.checkingPlans ? 'Checking plans…' : selected?.trial ? 'Start free trial' : 'Continue to purchase';

  return (
    <SafeAreaView ref={safe} key={fontScale} style={s.safe}>
      <PaywallMosaic height={mosaicHeight} />
      <View style={s.nav}>
        {props.onBack && !busy ? <Pressable onPress={props.onBack} style={s.back} accessibilityRole="button" accessibilityLabel="Go back" testID="welcome-back"><Ionicons name="chevron-back" size={22} color={EDITORIAL.green} /></Pressable> : <View style={s.back} />}
        <Text style={s.logo} testID="paywall-logo">fitsy<Text style={s.logoDot}>.</Text></Text>
        <Pressable onPress={props.onRestore} disabled={busy} style={s.navAction} accessibilityRole="button" testID="paywall-restore">
          <Text style={[s.restore, busy && s.disabled]}>{restoring ? 'Restoring…' : 'Restore'}</Text>
        </Pressable>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={[s.content, compact && s.contentCompact]} showsVerticalScrollIndicator={false} bounces={false}>
        <View style={timelineLayout && s.mainTimeline}>
          {!timelineLayout ? <><PaywallHero discovery={props.discovery} compact={compact} />
          <Text style={[s.title, compact && s.titleCompact]}>Find meals that fit.</Text>
          <View style={[s.benefits, compact && s.benefitsCompact]}>
            {PAYWALL_BENEFITS.map(benefit =>
              <View key={benefit} style={s.benefitRow}><Ionicons name="checkmark-circle" size={17} color={EDITORIAL.greenMid} /><Text style={[s.benefit, compact && s.benefitCompact]}>{benefit}</Text></View>)}
          </View></> : <PaywallOfferTimeline terms={selected} now={now} reminderAvailability={props.reminderAvailability} onFirstStepTop={onFirstStepTop} />}
        </View>
        <View>
          <View style={[s.cancelRow, compact && s.cancelRowCompact, timelineLayout && s.cancelRowTimeline]}><Ionicons name="checkmark" size={timelineLayout ? 18 : 15} color={EDITORIAL.green} /><Text style={[s.cancel, timelineLayout && s.cancelTimeline]}>No commitment, cancel anytime</Text></View>
          {props.visualPreview && <Text style={s.visualNote} testID="dev-trial-visual-note">Synthetic {props.visualPreview}-day trial{props.visualReminderSimulated ? ' and reminder-enabled state' : ''} for visual testing. Prices are from the live Test Store; purchase and reminder scheduling are disabled.</Text>}
          <View style={[s.plans, timelineLayout && s.plansTimeline]}>
            {([{ id: 'yearly', name: 'Annual', terms: annual }, { id: 'monthly', name: 'Monthly', terms: monthly }] as const).map(option => {
              const active = option.id === plan;
              return (
                <AnimatedPress key={option.id} style={[s.plan, compact && s.planCompact, largeText && s.planLarge, active && s.planSelected]} onPress={() => props.onSelect(option.id)}
                  disabled={planBusy || !option.terms} haptic accessibilityRole="radio" accessibilityState={{ checked: active, disabled: planBusy || !option.terms }} testID={`paywall-plan-${option.id}`}>
                  <View style={[s.radio, active && s.radioSelected]} accessible={false}>
                    {active && <Ionicons name="checkmark" size={13} color={EDITORIAL.cream} />}
                  </View>
                  <View style={s.planInfo}>
                    <Text style={s.planName}>{option.name}</Text>
                    {active && option.id === 'yearly' && !!props.annualSavingPercent && <Text style={s.saving} testID="paywall-annual-saving">Save {props.annualSavingPercent}%</Text>}
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
        </View>
        <View style={[s.footer, compact && s.footerCompact, timelineLayout && s.footerTimeline]}>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream },
  scroll: { flex: 1 },
  nav: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  back: { width: 64, height: 44, justifyContent: 'center' },
  logo: { fontFamily: FONTS.frauncesDisplayBold, fontSize: 27, lineHeight: 34, color: EDITORIAL.green, textAlign: 'center' },
  logoDot: { color: EDITORIAL.greenAccent },
  navAction: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  restore: { fontFamily: FONTS.nunitoSans, fontSize: 12, color: EDITORIAL.textMid, textDecorationLine: 'underline', textAlign: 'right' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 5 },
  contentCompact: { paddingHorizontal: 17 },
  mainTimeline: { flexGrow: 1, justifyContent: 'center' },
  title: { ...TEXT.title, fontSize: 25, lineHeight: 30, color: EDITORIAL.green, textAlign: 'center' },
  titleCompact: { fontSize: 23, lineHeight: 28 },
  benefits: { alignSelf: 'center', gap: 5, marginTop: 9 },
  benefitsCompact: { gap: 3, marginTop: 6 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  benefit: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 13, lineHeight: 19, color: EDITORIAL.green },
  benefitCompact: { fontSize: 12, lineHeight: 18 },
  cancelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 9, marginBottom: 12 },
  cancelRowCompact: { marginTop: 7, marginBottom: 8 },
  cancelRowTimeline: { marginTop: 8, marginBottom: 14 },
  cancel: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 12, lineHeight: 17, color: EDITORIAL.green, textAlign: 'center' },
  cancelTimeline: { fontSize: 15, lineHeight: 21 },
  visualNote: { ...TEXT.bodySmall, fontSize: 11, lineHeight: 15, color: EDITORIAL.textMid, textAlign: 'center', marginBottom: 8 },
  plans: { gap: 7 },
  plansTimeline: { gap: 12 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 6, minHeight: 52, borderRadius: 13, borderWidth: 1, borderColor: EDITORIAL.border, backgroundColor: EDITORIAL.cream },
  planCompact: { paddingVertical: 4, minHeight: 48, gap: 8 },
  planSelected: { backgroundColor: EDITORIAL.greenAccentTint, borderColor: EDITORIAL.greenMid },
  planLarge: { paddingHorizontal: 10 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: EDITORIAL.textSoft, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: EDITORIAL.greenMid, borderColor: EDITORIAL.greenMid },
  planInfo: { flex: 1, minWidth: 0 },
  planName: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 14, lineHeight: 18, color: EDITORIAL.green },
  saving: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 10, lineHeight: 13, color: EDITORIAL.greenMid },
  planNote: { fontFamily: FONTS.nunitoSans, fontSize: 10, lineHeight: 13, color: EDITORIAL.textMid },
  priceWrap: { alignItems: 'flex-end', flexShrink: 1 },
  priceWrapLarge: { flexShrink: 1 },
  price: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 17, color: EDITORIAL.green },
  pricePeriod: { fontFamily: FONTS.nunitoSans, fontSize: 11, color: EDITORIAL.textMid },
  retry: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingTop: 18 },
  footerCompact: { paddingTop: 14 },
  footerTimeline: { paddingTop: 18 },
  disclosure: { fontFamily: FONTS.nunitoSans, fontSize: 10, lineHeight: 14, color: EDITORIAL.textMid, textAlign: 'center', marginBottom: 8 },
  disclosureCompact: { marginBottom: 5 },
  cta: { minHeight: 47, paddingVertical: 8, paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, borderRadius: 30, backgroundColor: EDITORIAL.green },
  ctaCompact: { minHeight: 44 },
  ctaText: { flexShrink: 1, fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, lineHeight: 22, color: EDITORIAL.cream, textAlign: 'center' },
  disabled: { opacity: 0.4 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 2 },
  legalHit: { minWidth: 48, minHeight: 34, justifyContent: 'center', alignItems: 'center' },
  legalLink: { fontFamily: FONTS.nunitoSans, fontSize: 11, color: EDITORIAL.textMid, textDecorationLine: 'underline' },
  decline: { minHeight: 34, justifyContent: 'center', alignItems: 'center' },
  declineText: { fontFamily: FONTS.nunitoSans, fontSize: 12, color: EDITORIAL.textMid },
});
