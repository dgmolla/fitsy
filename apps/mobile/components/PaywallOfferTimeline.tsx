import React, { useRef } from 'react';
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
  if (match[2] === 'M' || match[2] === 'Y') {
    const day = date.getDate();
    // Store calendar periods end on the last day of a short destination month.
    // setMonth/setFullYear alone roll January 31 into March.
    date.setDate(1);
    if (match[2] === 'M') date.setMonth(date.getMonth() + count);
    else date.setFullYear(date.getFullYear() + count);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
  }
  return Number.isFinite(date.getTime()) ? date : null;
}

function elapsedCalendarDays(now: Date, date: Date): number {
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  return Math.max(0, Math.round((day(date) - day(now)) / 86_400_000));
}

function roundedUpLocalDays(now: Date, date: Date): number {
  const clock = (value: Date) => value.getHours() * 3_600_000 + value.getMinutes() * 60_000
    + value.getSeconds() * 1000 + value.getMilliseconds();
  // A quiet-hours adjustment may deliver on the prior calendar date, but a
  // partial day still belongs to the offer's next day in the countdown.
  return elapsedCalendarDays(now, date) + Number(clock(date) > clock(now));
}

export const PAYWALL_BENEFITS = [
  'Discover meals in Los Angeles',
  'Find nearby options for your goals',
  'Compare estimated nutrition',
] as const;

function Step({ icon, title, detail, last = false, testID, onTop }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; title: string; detail: string; last?: boolean; testID: string; onTop?: (top: number) => void;
}) {
  const step = useRef<View>(null);
  return <View ref={step} style={[s.step, last && s.lastStep]} testID={testID}
    onLayout={onTop ? () => requestAnimationFrame(() => step.current?.measureInWindow((_, top) => onTop(top))) : undefined}>
    {!last && <View style={s.connector} testID={`${testID}-connector`} />}
    <View style={s.icon} testID={`${testID}-circle`}><Ionicons name={icon} size={17} color={EDITORIAL.cream} /></View>
    <View style={s.copy}><Text style={s.when}>{title}</Text><Text style={s.detail}>{detail}</Text></View>
  </View>;
}

export function PaywallOfferTimeline({ terms, now, reminderAvailability = 'unavailable', onFirstStepTop }: {
  terms: Terms; now: Date; reminderAvailability?: ReminderAvailability; onFirstStepTop?: (top: number) => void;
}) {
  const chargeDate = projectedChargeDate(terms, now);
  if (!terms?.trial || !chargeDate) {
    return <View style={s.benefits} testID="paywall-offer-paid">
      {PAYWALL_BENEFITS.map(benefit => <View key={benefit} style={s.benefitRow}>
        <Ionicons name="checkmark-circle" size={17} color={EDITORIAL.greenMid} />
        <Text style={s.benefit}>{benefit}</Text>
      </View>)}
    </View>;
  }

  const reminderDate = canOfferTrialReminder(terms) ? trialReminderDate(chargeDate) : null;
  const usefulReminder = reminderDate && reminderDate > now && reminderDate < chargeDate;
  const reminderDay = usefulReminder ? roundedUpLocalDays(now, reminderDate) : null;
  const chargeDay = elapsedCalendarDays(now, chargeDate);
  const reminderCopy = reminderAvailability === 'enabled' && usefulReminder
    ? "We'll send you a reminder that your trial is ending soon"
    : reminderAvailability === 'permission-off'
      ? 'Notifications off. Enable them in settings.'
      : reminderAvailability === 'opt-in'
        ? 'Optional; turn on reminders after purchase.'
        : 'Unavailable; check your trial end in settings.';

  const chargeDateLabel = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(chargeDate);
  return <View style={s.panel} testID="paywall-offer-timeline">
    <Step icon="lock-open-outline" title="Today" detail="Unlock our library of Los Angeles restaurant nutrition, tailored to you" testID="paywall-step-today" onTop={onFirstStepTop} />
    <Step icon="notifications-outline"
      title={usefulReminder ? `In ${reminderDay} days` : 'Reminder unavailable'}
      detail={reminderCopy} testID="paywall-step-reminder" />
    <Step icon="calendar-outline" title={`In ${chargeDay} days`}
      detail={`You'll be charged on ${chargeDateLabel}`}
      last testID="paywall-step-charge" />
  </View>;
}

const s = StyleSheet.create({
  panel: { alignSelf: 'stretch', marginHorizontal: 5, marginTop: 14, paddingHorizontal: 17, paddingTop: 20, paddingBottom: 18 },
  benefits: { alignSelf: 'center', gap: 15, marginTop: 28, marginBottom: 12 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  benefit: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, lineHeight: 22, color: EDITORIAL.green },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, position: 'relative', paddingBottom: 28, minHeight: 72 },
  lastStep: { paddingBottom: 0 },
  // The rail spans the actual row height, including wrapped copy and spacing.
  // The next circle begins at this row's bottom edge.
  connector: { position: 'absolute', left: 15, top: 32, bottom: 0, width: 2, backgroundColor: EDITORIAL.greenMid },
  icon: { width: 32, height: 32, borderRadius: 16, backgroundColor: EDITORIAL.greenMid, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  copy: { flex: 1, minWidth: 0, minHeight: 32 },
  when: { fontFamily: FONTS.nunitoSansSemiBold, color: EDITORIAL.green, fontSize: 16, lineHeight: 21 },
  detail: { fontFamily: FONTS.nunitoSans, color: EDITORIAL.textMid, fontSize: 12, lineHeight: 17 },
});
