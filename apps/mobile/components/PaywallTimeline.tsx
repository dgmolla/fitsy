import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import type { purchaseTerms } from '@/lib/purchaseTerms';
import { TRIAL_REMINDER_LEAD_DAYS } from '@/lib/notificationPlan';

type Terms = ReturnType<typeof purchaseTerms>;
export function PaywallTimeline({ terms }: { terms: Terms }) {
  const reminderDay = terms?.trialDays ? terms.trialDays - TRIAL_REMINDER_LEAD_DAYS : null;
  const rows = terms?.trial ? [
    { icon: 'lock-open-outline' as const, title: 'Today', body: 'Unlock meals that fit your goals, full menus and saved favorites.' },
    { icon: 'notifications-outline' as const, title: reminderDay && reminderDay > 0 ? `Around day ${reminderDay}` : 'Before your trial ends', body: 'With notifications on, get a heads-up before your trial ends.' },
    { icon: 'sparkles-outline' as const, title: terms.trialDays ? `Day ${terms.trialDays}: billing starts` : `After ${terms.trial}: billing starts`, body: `${terms.recurring}, unless you cancel at least 24 hours before your trial ends.` },
  ] : [
    { icon: 'lock-open-outline' as const, title: terms ? 'Access starts today' : 'Your plan, clearly explained', body: 'Find meals that fit your goals, explore full menus and save favorites.' },
    { icon: 'card-outline' as const, title: terms ? 'Your first payment' : 'Checking store terms', body: terms?.charge ?? 'Current prices and eligible offers appear when the store finishes loading.' },
    { icon: 'calendar-outline' as const, title: 'You stay in control', body: 'Manage your subscription in settings. Cancel at least 24 hours before renewal.' },
  ];
  return <View style={s.timeline} testID="paywall-timeline">{rows.map((row, i) => <View key={row.title} style={s.row}>
    <View style={s.track}>{i < rows.length - 1 && <View style={s.line} />}<View style={[s.icon, i === rows.length - 1 && s.lastIcon]}>
      <Ionicons name={row.icon} size={20} color={i === rows.length - 1 ? EDITORIAL.cream : EDITORIAL.green} />
    </View></View>
    <View style={s.copy}><Text style={s.title}>{row.title}</Text><Text style={s.body}>{row.body}</Text></View>
  </View>)}</View>;
}
const s = StyleSheet.create({
  timeline: { marginVertical: 22 },
  row: { flexDirection: 'row', gap: 14 },
  track: { width: 36, alignItems: 'center' },
  line: { position: 'absolute', top: 30, bottom: -8, width: 4, backgroundColor: EDITORIAL.greenAccentTint },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: EDITORIAL.greenAccentTint, alignItems: 'center', justifyContent: 'center' },
  lastIcon: { backgroundColor: EDITORIAL.green },
  copy: { flex: 1, paddingTop: 3, paddingBottom: 20 },
  title: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, lineHeight: 21, color: EDITORIAL.green },
  body: { fontFamily: FONTS.nunitoSans, fontSize: 13, lineHeight: 19, color: EDITORIAL.textMid, marginTop: 4 },
});
