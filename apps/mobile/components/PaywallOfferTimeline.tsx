import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { canOfferTrialReminder, trialReminderDate } from '@/lib/notificationPlan';
import type { purchaseTerms } from '@/lib/purchaseTerms';

type Terms = ReturnType<typeof purchaseTerms>;
export type ReminderAvailability = 'enabled' | 'opt-in' | 'permission-off' | 'unavailable';

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

function elapsedCalendarDays(now: Date, date: Date): number {
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  return Math.max(0, Math.round((day(date) - day(now)) / 86_400_000));
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Step({ icon, title, detail, last = false, testID }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; title: string; detail: string; last?: boolean; testID: string;
}) {
  return <View style={[s.step, last && s.lastStep]} testID={testID}>
    {!last && <View style={s.connector} testID={`${testID}-connector`} />}
    <View style={s.icon} testID={`${testID}-circle`}><Ionicons name={icon} size={17} color={EDITORIAL.cream} /></View>
    <View style={s.copy}><Text style={s.when}>{title}</Text><Text style={s.detail}>{detail}</Text></View>
  </View>;
}

export function PaywallOfferTimeline({ terms, now, reminderAvailability = 'unavailable' }: {
  terms: Terms; now: Date; reminderAvailability?: ReminderAvailability;
}) {
  const chargeDate = projectedChargeDate(terms, now);
  if (!terms?.trial || !chargeDate) {
    return <View style={s.paidPanel} testID="paywall-offer-paid">
      <Text style={s.paidTitle}>Unlock Fitsy today</Text>
      <Text style={s.paidDetail}>{terms ? `${terms.price} when you confirm, then ${terms.recurring}.` : 'The store will show your price before purchase.'}</Text>
    </View>;
  }

  const reminderDate = canOfferTrialReminder(terms) ? trialReminderDate(chargeDate) : null;
  const usefulReminder = reminderDate && reminderDate > now && reminderDate < chargeDate;
  const reminderDay = usefulReminder ? elapsedCalendarDays(now, reminderDate) : null;
  const chargeDay = elapsedCalendarDays(now, chargeDate);
  const reminderCopy = reminderAvailability === 'enabled'
    ? 'Reminder opted in. We schedule it after the store confirms your trial end; check settings afterward.'
    : reminderAvailability === 'permission-off'
      ? 'Notifications are off. Enable them in device settings if you want a reminder.'
      : reminderAvailability === 'opt-in'
        ? 'Optional reminder. Turn it on in notification settings after purchase.'
        : 'Reminder scheduling is unavailable. Check your trial end in subscription settings.';

  return <View style={s.panel} testID="paywall-offer-timeline">
    <Step icon="lock-open-outline" title="Today" detail="Start your trial and unlock Fitsy Pro features." testID="paywall-step-today" />
    <Step icon="notifications-outline"
      title={usefulReminder ? `Day ${reminderDay} · ${dateLabel(reminderDate)}` : 'Before your trial ends'}
      detail={reminderCopy} testID="paywall-step-reminder" />
    <Step icon="calendar-outline" title={`Day ${chargeDay} · ${dateLabel(chargeDate)}`}
      detail={`If you start today, your first ${terms.price} charge begins on ${dateLabel(chargeDate)}. Then ${terms.recurring}.`}
      last testID="paywall-step-charge" />
    <Text style={s.note}>Projected dates. The store confirms your exact trial end and charge date before purchase.</Text>
  </View>;
}

const s = StyleSheet.create({
  panel: { alignSelf: 'stretch', marginHorizontal: 5, marginTop: 14, paddingHorizontal: 17, paddingTop: 18, paddingBottom: 12, borderRadius: 20, backgroundColor: 'rgba(253,251,247,0.88)' },
  paidPanel: { alignSelf: 'stretch', marginHorizontal: 5, marginTop: 24, paddingHorizontal: 19, paddingVertical: 19, borderRadius: 20, backgroundColor: 'rgba(253,251,247,0.88)' },
  paidTitle: { fontFamily: FONTS.frauncesDisplayBold, fontSize: 23, lineHeight: 29, color: EDITORIAL.green, textAlign: 'center' },
  paidDetail: { fontFamily: FONTS.nunitoSans, fontSize: 13, lineHeight: 19, color: EDITORIAL.textMid, textAlign: 'center', marginTop: 7 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, position: 'relative', paddingBottom: 14, minHeight: 46 },
  lastStep: { paddingBottom: 0 },
  // The rail spans the actual row height, including wrapped copy and spacing.
  // The next circle begins at this row's bottom edge.
  connector: { position: 'absolute', left: 15, top: 32, bottom: 0, width: 2, backgroundColor: EDITORIAL.greenMid },
  icon: { width: 32, height: 32, borderRadius: 16, backgroundColor: EDITORIAL.greenMid, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  copy: { flex: 1, minWidth: 0, minHeight: 32 },
  when: { fontFamily: FONTS.nunitoSansSemiBold, color: EDITORIAL.green, fontSize: 16, lineHeight: 21 },
  detail: { fontFamily: FONTS.nunitoSans, color: EDITORIAL.textMid, fontSize: 12, lineHeight: 17 },
  note: { fontFamily: FONTS.nunitoSans, color: EDITORIAL.textMid, fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 9 },
});
