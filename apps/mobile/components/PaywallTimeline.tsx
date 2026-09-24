import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { canOfferTrialReminder, TRIAL_REMINDER_LEAD_DAYS } from '@/lib/notificationPlan';
import type { purchaseTerms } from '@/lib/purchaseTerms';

type Terms = ReturnType<typeof purchaseTerms>;
export function PaywallTimeline({ terms, compact = false }: { terms: Terms; compact?: boolean }) {
  const reminderDay = terms?.trialDays ? terms.trialDays - TRIAL_REMINDER_LEAD_DAYS : null;
  const canRemind = canOfferTrialReminder(terms);
  const rows = terms?.trial ? [
    { icon: 'lock-open-outline' as const, title: 'Today', body: 'Unlock meals that fit your goals, full menus and saved favorites.' },
    { icon: 'notifications-outline' as const, title: !canRemind ? 'Reminder unavailable for this trial' : reminderDay ? `Optional reminder around day ${reminderDay}` : 'Optional reminder, if available',
      body: canRemind ? 'Requires permission and a confirmed trial end date.' : 'This trial ends too soon to schedule a reminder before the cancellation deadline.' },
    { icon: 'card-outline' as const, title: terms.trialDays ? `Day ${terms.trialDays}: payment` : `After ${terms.trial}: payment`, body: `${terms.recurring}, unless canceled at least 24 hours before trial end.` },
  ] : [
    { icon: 'lock-open-outline' as const, title: terms ? 'Access starts today' : 'Your plan, clearly explained', body: 'Find meals that fit your goals, explore full menus and save favorites.' },
    { icon: 'card-outline' as const, title: terms ? 'Your first payment' : 'Checking store terms', body: terms?.charge ?? 'Current prices and eligible offers appear when the store finishes loading.' },
    { icon: 'calendar-outline' as const, title: 'You stay in control', body: 'Manage your subscription in settings. Cancel at least 24 hours before renewal.' },
  ];
  return <View style={[s.timeline, compact && s.timelineCompact]} testID="paywall-timeline">{rows.map((row, i) => <View key={row.title} style={s.row}>
    <View style={s.track}>{i < rows.length - 1 && <View style={s.line} />}<View style={[s.icon, i === rows.length - 1 && s.lastIcon]}>
      <Ionicons name={row.icon} size={20} color={i === rows.length - 1 ? EDITORIAL.cream : EDITORIAL.green} />
    </View></View>
    <View style={[s.copy, compact && s.copyCompact]}><Text style={s.title}>{row.title}</Text><Text style={[s.body, compact && s.bodyCompact]}>{row.body}</Text></View>
  </View>)}</View>;
}
const s = StyleSheet.create({
  timeline: { marginVertical: 12 },
  timelineCompact: { marginVertical: 7 },
  row: { flexDirection: 'row', gap: 14 },
  track: { width: 36, alignItems: 'center' },
  line: { position: 'absolute', top: 30, bottom: -8, width: 4, backgroundColor: EDITORIAL.greenAccentTint },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: EDITORIAL.greenAccentTint, alignItems: 'center', justifyContent: 'center' },
  lastIcon: { backgroundColor: EDITORIAL.green },
  copy: { flex: 1, paddingTop: 2, paddingBottom: 10 },
  copyCompact: { paddingBottom: 5 },
  title: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, lineHeight: 21, color: EDITORIAL.green },
  body: { fontFamily: FONTS.nunitoSans, fontSize: 13, lineHeight: 17, color: EDITORIAL.textMid, marginTop: 2 },
  bodyCompact: { fontSize: 12, lineHeight: 15 },
});
