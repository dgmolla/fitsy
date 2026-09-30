import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import type { purchaseTerms } from '@/lib/purchaseTerms';

type Terms = ReturnType<typeof purchaseTerms>;

/** Calendar-aware projected first charge, conditional on starting today. */
export function projectedChargeDate(terms: Terms, now: Date): Date | null {
  const match = /^P([1-9]\d*)([DWMY])$/.exec(terms?.trialPeriod ?? '');
  if (!terms?.trial || !match || !terms.trialCycles || !Number.isInteger(terms.trialCycles)) return null;
  const count = Number(match[1]) * terms.trialCycles;
  const date = new Date(now);
  if (match[2] === 'D') date.setDate(date.getDate() + count);
  if (match[2] === 'W') date.setDate(date.getDate() + count * 7);
  if (match[2] === 'M') date.setMonth(date.getMonth() + count);
  if (match[2] === 'Y') date.setFullYear(date.getFullYear() + count);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function PaywallOfferTimeline({ terms, now }: { terms: Terms; now: Date }) {
  const date = projectedChargeDate(terms, now);
  const trial = !!terms?.trial && !!date;
  return <View style={s.panel} testID="paywall-offer-timeline">
    <Text style={s.title}>{trial ? 'Your Fitsy trial' : 'Your Fitsy plan'}</Text>
    <View style={s.row}>
      <View style={s.icon}><Ionicons name="lock-open-outline" size={17} color={EDITORIAL.cream} /></View>
      <View style={s.copy}><Text style={s.when}>Today</Text><Text style={s.detail}>{trial ? 'Unlock meals that fit when you start your trial.' : 'Unlock meals that fit when you confirm your purchase.'}</Text></View>
    </View>
    <View style={s.line} />
    <View style={s.row}>
      <View style={s.icon}><Ionicons name="calendar-outline" size={17} color={EDITORIAL.cream} /></View>
      <View style={s.copy}><Text style={s.when}>{trial ? `After ${terms?.trial}` : 'When you confirm'}</Text>
        <Text style={s.detail}>{trial ? `If you start today, your first ${terms?.price} charge is ${date?.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}. Then ${terms?.recurring}.` : `${terms?.price ?? 'Store price'} is charged, then ${terms?.recurring ?? 'the selected plan renews'}.`}</Text></View>
    </View>
    <Text style={s.note}>{trial ? 'Your store confirms the exact trial end and charge date before purchase.' : 'Your store confirms the exact charge before purchase.'}</Text>
  </View>;
}

const s = StyleSheet.create({
  panel: { alignSelf: 'stretch', paddingHorizontal: 22, paddingTop: 17, paddingBottom: 9, minHeight: 266 },
  title: { fontFamily: FONTS.frauncesDisplayBold, fontSize: 25, lineHeight: 31, color: EDITORIAL.green, textAlign: 'center', marginBottom: 16 },
  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  icon: { width: 32, height: 32, borderRadius: 16, backgroundColor: EDITORIAL.greenMid, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, paddingBottom: 9 },
  when: { fontFamily: FONTS.nunitoSansSemiBold, color: EDITORIAL.green, fontSize: 16, lineHeight: 21 },
  detail: { fontFamily: FONTS.nunitoSans, color: EDITORIAL.textMid, fontSize: 12, lineHeight: 17 },
  line: { width: 2, height: 20, backgroundColor: EDITORIAL.greenAccentTint, marginLeft: 15, marginVertical: 2 },
  note: { fontFamily: FONTS.nunitoSans, color: EDITORIAL.textMid, fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 10 },
});
